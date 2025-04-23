

const DeficiencyTracker = (() => {

    function loadDeficiencyList(){
        const passed_data = ""
        fetch("/deficiency_tracker/deficiency_list", {
            method: "POST",
            headers: { "Content-Type":  "application/json" },
            body: passed_data
        })
        .then(response => response.json())
        .then(data => {
            console.log("received data from backend!")
        })
    }


    function init() {
        loadDeficiencyList()
    }

    return {
        init
    };
})();




document.addEventListener("DOMContentLoaded", () => {
    console.log("Deficiency Tracker loaded!")
    DeficiencyTracker.init();
});