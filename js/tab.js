$(document).ready(function () {
    $(".nav-tabs li button").click(function (event) {
        updateStyle(event, this, ".nav-tabs", ".tab-content", "tab");
    });

    $(".content-toggle li button").click(function (event) {
        updateStyle(event, this, ".content-toggle", ".toggle-panel", "toggle");
    });

    function updateStyle(event, target, itemsClass, panelsClass, itemPrefix) {
        event.preventDefault();

        // Remove active class for all items and panels.
        $(itemsClass + " li").find(".active").removeClass("active").attr("aria-selected", "false");
        $(panelsClass).find(".active").removeClass("active");

        var itemName = $(target).attr("title").replace(itemPrefix, "");

        // Add active class for all items and panels with the same name.
        $(itemsClass + " button[title='" + itemPrefix + itemName + "']")
            .addClass("active").attr("aria-selected", "true");
        $(panelsClass + " div[title='" + itemPrefix + "-pane" + itemName + "']").addClass("active");
    }
});
