$(document).ready(function () {
    const urlParams = new URLSearchParams(window.location.search);
    $(".content-toggle button[title='toggle-" + urlParams.get("client") + "']").trigger("click");
});
