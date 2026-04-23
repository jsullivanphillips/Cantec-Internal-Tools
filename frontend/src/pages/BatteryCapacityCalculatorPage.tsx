import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card } from 'react-bootstrap'

type BatteryVoltage = '6' | '12' | '24'

type CalculatorInputs = {
  supervisoryCurrent: string
  supervisoryRequirement: string
  fullLoadCurrent: string
  alarmRequirement: string
  deratingFactor: string
  batteryQty: string
  batteryVoltage: BatteryVoltage
  batteryAhEach: string
}

const DEFAULT_INPUTS: CalculatorInputs = {
  supervisoryCurrent: '',
  supervisoryRequirement: '24',
  fullLoadCurrent: '',
  alarmRequirement: '0.5',
  deratingFactor: '1.2',
  batteryQty: '',
  batteryVoltage: '12',
  batteryAhEach: '',
}

function parseNumber(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function formatAh(value: number) {
  return `${value.toFixed(2)} Ah`
}

function formatDiff(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} Ah`
}

function calculateInstalledSetAh(quantity: number, voltage: number, ahEach: number) {
  if (quantity <= 0 || ahEach <= 0) return 0
  if (voltage === 24) return ahEach
  if (voltage === 12 || voltage === 6) {
    return ahEach
  }
  return 0
}

export default function BatteryCapacityCalculatorPage() {
  const [inputs, setInputs] = useState<CalculatorInputs>(DEFAULT_INPUTS)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [actionsLayout, setActionsLayout] = useState({ left: 0, width: 0 })

  const results = useMemo(() => {
    const supervisoryCurrent = parseNumber(inputs.supervisoryCurrent)
    const supervisoryRequirement = parseNumber(inputs.supervisoryRequirement)
    const fullLoadCurrent = parseNumber(inputs.fullLoadCurrent)
    const alarmRequirement = parseNumber(inputs.alarmRequirement)
    const deratingFactor = parseNumber(inputs.deratingFactor)
    const batteryQty = parseNumber(inputs.batteryQty)
    const batteryVoltage = parseNumber(inputs.batteryVoltage)
    const batteryAhEach = parseNumber(inputs.batteryAhEach)

    const supervisoryAh = supervisoryCurrent * supervisoryRequirement
    const fullLoadAh = fullLoadCurrent * alarmRequirement
    const subtotalAh = supervisoryAh + fullLoadAh
    const requiredAh = subtotalAh * deratingFactor
    const installedAh = calculateInstalledSetAh(batteryQty, batteryVoltage, batteryAhEach)
    const differenceAh = installedAh - requiredAh
    const passes = installedAh >= requiredAh && requiredAh > 0

    return {
      supervisoryAh,
      fullLoadAh,
      subtotalAh,
      requiredAh,
      installedAh,
      differenceAh,
      passes,
    }
  }, [inputs])

  function updateInput<K extends keyof CalculatorInputs>(field: K, value: CalculatorInputs[K]) {
    setInputs((prev) => ({ ...prev, [field]: value }))
  }

  function resetCalculator() {
    setInputs(DEFAULT_INPUTS)
  }

  const canShowPassFailBanner =
    inputs.supervisoryCurrent.trim() !== '' &&
    inputs.fullLoadCurrent.trim() !== '' &&
    inputs.batteryQty.trim() !== '' &&
    inputs.batteryAhEach.trim() !== ''

  useEffect(() => {
    function syncActionsLayout() {
      const node = containerRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      setActionsLayout({
        left: Math.max(0, rect.left),
        width: Math.max(0, rect.width),
      })
    }

    syncActionsLayout()
    window.addEventListener('resize', syncActionsLayout)
    window.addEventListener('scroll', syncActionsLayout, { passive: true })

    return () => {
      window.removeEventListener('resize', syncActionsLayout)
      window.removeEventListener('scroll', syncActionsLayout)
    }
  }, [])

  return (
    <div className="battery-calculator-page">
      <div className="battery-calculator-container" ref={containerRef}>
        <Card className="app-surface-card battery-calculator-header-card">
          <Card.Body className="p-3 p-md-4">
            <h1 className="battery-calculator-title">Cantec Fire Alarms&apos; Battery Capacity Calculator</h1>
            <p className="battery-calculator-subtitle">
              Use this calculator to determine the required system battery capacity in Ah for entry into 22.5(p) of the CAN/ULC
              S536-19 Report
            </p>
          </Card.Body>
        </Card>

        <Card className="battery-calculator-card">
          <Card.Body>
            <h2>Supervisory Calculation</h2>
            <div className="battery-calculator-formula-row">
              <div>
                <label htmlFor="supervisoryCurrent">Supervisory Current as per 22.5(d)</label>
                <input
                  id="supervisoryCurrent"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Amps"
                  value={inputs.supervisoryCurrent}
                  onChange={(event) => updateInput('supervisoryCurrent', event.target.value)}
                />
              </div>
              <div className="battery-calculator-symbol">x</div>
              <div>
                <label htmlFor="supervisoryRequirement">Supervisory Requirement</label>
                <select
                  id="supervisoryRequirement"
                  value={inputs.supervisoryRequirement}
                  onChange={(event) => updateInput('supervisoryRequirement', event.target.value)}
                >
                  <option value="24">24 hrs = 24</option>
                  <option value="4">4 hrs = 4</option>
                </select>
              </div>
              <div className="battery-calculator-symbol">=</div>
              <div className="battery-calculator-result-box">
                <div className="battery-calculator-result-label">Total Supervisory Ah</div>
                <div className="battery-calculator-result-value">{formatAh(results.supervisoryAh)}</div>
              </div>
            </div>
          </Card.Body>
        </Card>

        <Card className="battery-calculator-card">
          <Card.Body>
            <h2>Full Load Requirements</h2>
            <div className="battery-calculator-formula-row">
              <div>
                <label htmlFor="fullLoadCurrent">Full Load Current as per 22.5(e)</label>
                <input
                  id="fullLoadCurrent"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Amps"
                  value={inputs.fullLoadCurrent}
                  onChange={(event) => updateInput('fullLoadCurrent', event.target.value)}
                />
              </div>
              <div className="battery-calculator-symbol">x</div>
              <div>
                <label htmlFor="alarmRequirement">Alarm Requirement</label>
                <select
                  id="alarmRequirement"
                  value={inputs.alarmRequirement}
                  onChange={(event) => updateInput('alarmRequirement', event.target.value)}
                >
                  <option value="0.0833">5 minutes (0.0833 h)</option>
                  <option value="0.5">30 minutes (0.5 h)</option>
                  <option value="1">1 hour (1.0 h)</option>
                  <option value="2">2 hours (2.0 h)</option>
                </select>
              </div>
              <div className="battery-calculator-symbol">=</div>
              <div className="battery-calculator-result-box">
                <div className="battery-calculator-result-label">Total Full Load Ah</div>
                <div className="battery-calculator-result-value">{formatAh(results.fullLoadAh)}</div>
              </div>
            </div>
          </Card.Body>
        </Card>

        <Card className="battery-calculator-card">
          <Card.Body>
            <h2>Battery Capacity Total (Before Derating Factor)</h2>
            <div className="battery-calculator-formula-row">
              <div className="battery-calculator-result-box">
                <div className="battery-calculator-result-label">Total Supervisory Ah</div>
                <div className="battery-calculator-result-value">{formatAh(results.supervisoryAh)}</div>
              </div>
              <div className="battery-calculator-symbol">+</div>
              <div className="battery-calculator-result-box">
                <div className="battery-calculator-result-label">Total Full Load Ah</div>
                <div className="battery-calculator-result-value">{formatAh(results.fullLoadAh)}</div>
              </div>
              <div className="battery-calculator-symbol">=</div>
              <div className="battery-calculator-result-box">
                <div className="battery-calculator-result-label">Subtotal Ah</div>
                <div className="battery-calculator-result-value">{formatAh(results.subtotalAh)}</div>
              </div>
            </div>
          </Card.Body>
        </Card>

        <Card className="battery-calculator-card">
          <Card.Body>
            <h2>Battery Capacity Total (After Derating Factor)</h2>
            <div className="battery-calculator-formula-row">
              <div className="battery-calculator-result-box">
                <div className="battery-calculator-result-label">Subtotal Ah</div>
                <div className="battery-calculator-result-value">{formatAh(results.subtotalAh)}</div>
              </div>
              <div className="battery-calculator-symbol">x</div>
              <div>
                <label htmlFor="deratingFactor">Derating Factor</label>
                <input
                  id="deratingFactor"
                  type="number"
                  min="0"
                  step="any"
                  value={inputs.deratingFactor}
                  onChange={(event) => updateInput('deratingFactor', event.target.value)}
                />
              </div>
              <div className="battery-calculator-symbol">=</div>
              <div className="battery-calculator-result-box">
                <div className="battery-calculator-result-label">Final System Battery Capacity Requirement Ah</div>
                <div className="battery-calculator-result-value">{formatAh(results.requiredAh)}</div>
              </div>
            </div>
            <div className="battery-calculator-helper-text">20% is typical (1.2)</div>
          </Card.Body>
        </Card>

        <Card className="battery-calculator-card">
          <Card.Body>
            <h2>Installed Battery Comparison</h2>
            <div className="battery-calculator-battery-row">
              <div>
                <label htmlFor="batteryQty">Number of Batteries</label>
                <input
                  id="batteryQty"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Qty"
                  value={inputs.batteryQty}
                  onChange={(event) => updateInput('batteryQty', event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="batteryVoltage">Battery Voltage</label>
                <select
                  id="batteryVoltage"
                  value={inputs.batteryVoltage}
                  onChange={(event) => updateInput('batteryVoltage', event.target.value as BatteryVoltage)}
                >
                  <option value="6">6V</option>
                  <option value="12">12V</option>
                  <option value="24">24V</option>
                </select>
              </div>
              <div>
                <label htmlFor="batteryAhEach">Battery Ah Rating</label>
                <input
                  id="batteryAhEach"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Ah each"
                  value={inputs.batteryAhEach}
                  onChange={(event) => updateInput('batteryAhEach', event.target.value)}
                />
              </div>
              <div className="battery-calculator-result-box">
                <div className="battery-calculator-result-label">Installed Battery Set Ah</div>
                <div className="battery-calculator-result-value">{formatAh(results.installedAh)}</div>
              </div>
            </div>

            <div className="battery-calculator-note">
              This calculator uses quantity, voltage, and Ah rating to estimate the installed battery set. It does not verify battery
              type or manufacturer compatibility automatically.
            </div>

            <div className="battery-calculator-summary-grid">
              <div className="battery-calculator-summary-box">
                <div className="battery-calculator-summary-key">Calculated Requirement</div>
                <div className="battery-calculator-summary-value">{formatAh(results.requiredAh)}</div>
              </div>
              <div className="battery-calculator-summary-box">
                <div className="battery-calculator-summary-key">Installed Battery Set</div>
                <div className="battery-calculator-summary-value">{formatAh(results.installedAh)}</div>
              </div>
              <div className="battery-calculator-summary-box">
                <div className="battery-calculator-summary-key">Difference</div>
                <div className="battery-calculator-summary-value">{formatDiff(results.differenceAh)}</div>
              </div>
            </div>

            {canShowPassFailBanner ? (
              <div className={`battery-calculator-banner ${results.passes ? 'battery-calculator-banner-pass' : 'battery-calculator-banner-fail'}`}>
                {results.passes ? 'PASS' : 'FAIL - Installed Ah is insufficient'}
              </div>
            ) : null}
          </Card.Body>
        </Card>

        <Card className="battery-calculator-card battery-calculator-info-card">
          <Card.Body>
            <strong>Explanatory Material</strong>
            <p className="mb-2 mt-3">
              &quot;Derating factor&quot;: Otherwise known as a Safety Factor, is a multiplier used to reduce the usable capacity of a
              battery to account for real-world conditions. 20% is typical (1.2). Examples of real-world conditions include temperature
              changes, battery aging, discharge characteristics under load, charger tolerance, and reduced performance over time.
            </p>
            <p className="mb-2">Your batteries suffice only if all of the following are true:</p>
            <ul className="mb-0">
              <li>the installed battery set Ah is equal to or greater than the calculated System Battery Capacity Requirement Ah</li>
              <li>the battery type and size are acceptable for that control unit/manufacturer</li>
            </ul>
          </Card.Body>
        </Card>

        <div
          className="battery-calculator-actions"
          style={{
            left: `${actionsLayout.left}px`,
            width: `${actionsLayout.width}px`,
          }}
        >
          <div className="battery-calculator-actions-inner">
            <Button variant="secondary" className="battery-calculator-reset-btn" onClick={resetCalculator}>
              Reset Calculator
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
