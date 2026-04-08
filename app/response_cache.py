import json
import logging
import threading
import time
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Callable

from flask import jsonify, request, Response, session

log = logging.getLogger("response-cache")


@dataclass
class _CacheEntry:
    data: Any
    status: int
    expires_at: float


_LOCK = threading.RLock()
_STORE: dict[str, _CacheEntry] = {}
_STATS = {"hit": 0, "miss": 0, "set": 0, "evict": 0, "skip_bust": 0}


def init_response_cache(_app) -> None:
    """Lifecycle hook for app startup (in-memory cache is module-scoped)."""
    log.info("response cache initialized (in-memory)")


def _stable_dump(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _normalize_body(source: Any, body_fields: tuple[str, ...] | None) -> Any:
    if not isinstance(source, dict):
        return source
    if not body_fields:
        return source
    return {k: source.get(k) for k in body_fields}


def _build_key(
    prefix: str,
    *,
    include_query: bool,
    include_body: bool,
    body_fields: tuple[str, ...] | None,
) -> str:
    parts = [prefix, request.path]
    user_scope = session.get("username") or session.get("user_id") or "anon"
    parts.append(str(user_scope))
    if include_query:
        query_pairs = request.args.items(multi=True)
        parts.append(_stable_dump(sorted(query_pairs)))
    if include_body:
        body = request.get_json(silent=True) or {}
        body = _normalize_body(body, body_fields)
        parts.append(_stable_dump(body))
    digest = sha256("|".join(parts).encode("utf-8")).hexdigest()
    return f"{prefix}:{digest}"


def _coerce_result(result: Any) -> tuple[Any, int]:
    if isinstance(result, Response):
        payload = result.get_json(silent=True)
        return payload, result.status_code
    if isinstance(result, tuple):
        payload = result[0]
        status = int(result[1]) if len(result) > 1 else 200
        if isinstance(payload, Response):
            payload = payload.get_json(silent=True)
        return payload, status
    return result, 200


def invalidate_cache_prefix(prefix: str) -> int:
    with _LOCK:
        keys = [k for k in _STORE if k.startswith(prefix)]
        for k in keys:
            _STORE.pop(k, None)
        if keys:
            _STATS["evict"] += len(keys)
            log.info("response cache evicted %s entries for prefix=%s", len(keys), prefix)
        return len(keys)


def cached_json_response(
    *,
    prefix: str,
    ttl_seconds: int,
    include_query: bool = True,
    include_body: bool = False,
    body_fields: tuple[str, ...] | None = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """
    Decorator for JSON endpoints.
    - Supports GET and read-like POST.
    - Returns cached jsonify(payload), status when hit.
    """

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        def wrapped(*args, **kwargs):
            if request.args.get("cache_bust") in ("1", "true", "True"):
                _STATS["skip_bust"] += 1
                return fn(*args, **kwargs)

            key = _build_key(
                prefix,
                include_query=include_query,
                include_body=include_body,
                body_fields=body_fields,
            )
            now = time.time()

            with _LOCK:
                hit = _STORE.get(key)
                if hit and hit.expires_at > now:
                    _STATS["hit"] += 1
                    log.debug("response cache hit key=%s", key)
                    return jsonify(hit.data), hit.status
                _STATS["miss"] += 1
                if hit:
                    _STORE.pop(key, None)

            result = fn(*args, **kwargs)
            payload, status = _coerce_result(result)
            if payload is None:
                return result

            with _LOCK:
                _STORE[key] = _CacheEntry(
                    data=payload,
                    status=status,
                    expires_at=now + max(1, int(ttl_seconds)),
                )
                _STATS["set"] += 1
                if _STATS["set"] % 50 == 0:
                    log.info("response cache stats=%s size=%s", dict(_STATS), len(_STORE))

            return jsonify(payload), status

        wrapped.__name__ = fn.__name__
        wrapped.__doc__ = fn.__doc__
        return wrapped

    return decorator
