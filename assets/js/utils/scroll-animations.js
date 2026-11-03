(function () {
  "use strict";

  const observer = new IntersectionObserver(
    function (entries, observer) {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("fade-in-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      root: null,
      rootMargin: "0px",
      threshold: 0.1
    }
  );

  function addAnimation(element) {
    if (element && !element.classList.contains("fade-in")) {
      element.classList.add("fade-in");
      observer.observe(element);
    }
  }

  function init() {
    let selector;
    selector = document.body.classList.contains("home")
      ? ".home section, .home .grit-section"
      : "section, .grit-section, .grit-grid, .course-card, .inst-card, .gallery-item, article, .home-notice-item, .home-qna-item, .home-course-item";

    document.querySelectorAll(selector).forEach(addAnimation);
  }

  window.applyScrollAnimation = function (elements) {
    if (elements) {
      if (elements.nodeType === 1) {
        addAnimation(elements);
      } else if (elements.length) {
        Array.from(elements).forEach(addAnimation);
      }
    }
  };

  const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          if (
            node.matches &&
            node.matches(
              "section, .grit-section, .course-card, .inst-card, .gallery-item, article, .home-notice-item, .home-qna-item, .home-course-item"
            )
          ) {
            addAnimation(node);
          }
          node
            .querySelectorAll(
              "section, .grit-section, .course-card, .inst-card, .gallery-item, article, .home-notice-item, .home-qna-item, .home-course-item"
            )
            .forEach(addAnimation);
        }
      });
    });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init();
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    });
  } else {
    init();
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
})();
