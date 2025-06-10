const PerformanceSummary = (() => {
    function init() {
    document.addEventListener("DOMContentLoaded", () => {

        console.log("Loaded!")
    });
  }
  return { init };
})();

PerformanceSummary.init()