(function () {
  var nav = document.getElementById("nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  var menuBtn = document.getElementById("menuBtn");
  var sidebar = document.getElementById("sidebar");
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", function () {
      sidebar.classList.toggle("open");
    });
    sidebar.addEventListener("click", function (e) {
      if (e.target.closest("a")) sidebar.classList.remove("open");
    });
  }

  document.querySelectorAll(".tabs").forEach(function (tabs) {
    var scope = tabs.parentElement;
    tabs.querySelectorAll(".tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        tabs.querySelectorAll(".tab").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        scope.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
        var panel = scope.querySelector("#" + btn.getAttribute("data-tab"));
        if (panel) panel.classList.add("active");
      });
    });
  });

  if ("IntersectionObserver" in window) {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          revealIO.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach(function (el) { revealIO.observe(el); });

    var links = Array.prototype.slice.call(document.querySelectorAll(".side-link"));
    if (links.length) {
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            links.forEach(function (l) { l.classList.remove("current"); });
            var active = document.querySelector('.side-link[href="#' + en.target.id + '"]');
            if (active) active.classList.add("current");
          }
        });
      }, { rootMargin: "-15% 0px -70% 0px" });
      document.querySelectorAll(".docs-content h2[id]").forEach(function (h) { spy.observe(h); });
    }
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
  }

  var LANGS = {
    ts: {
      re: /(\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b(import|from|await|async|const|new|return|true|false|null|undefined)\b|\b(\d+)\b/g,
      cls: ["c-com", "c-str", "c-key", "c-num"]
    },
    prisma: {
      re: /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|\b(generator|model|enum|datasource|provider|output)\b|(@\w+)/g,
      cls: ["c-com", "c-str", "c-key", "c-fn"]
    },
    bash: {
      re: /(#[^\n]*)|("[^"\n]*")|(\bnpm\b|\bnpx\b)/g,
      cls: ["c-com", "c-str", "c-fn"]
    }
  };

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlight(el) {
    var lang = LANGS[el.getAttribute("data-lang")] || LANGS.ts;
    var src = el.textContent;
    var out = "";
    var last = 0;
    var m;
    lang.re.lastIndex = 0;
    while ((m = lang.re.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      for (var g = 1; g <= lang.cls.length; g++) {
        if (m[g] !== undefined) {
          out += '<span class="' + lang.cls[g - 1] + '">' + esc(m[g]) + "</span>";
          break;
        }
      }
      last = m.index + m[0].length;
      if (m[0].length === 0) lang.re.lastIndex++;
    }
    out += esc(src.slice(last));
    el.innerHTML = out;
  }

  document.querySelectorAll("pre code[data-lang]").forEach(highlight);

  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var block = btn.closest(".codeblock");
      var code = block && block.querySelector("pre code");
      if (!code) return;
      var done = function () {
        btn.textContent = "copied";
        setTimeout(function () { btn.textContent = "copy"; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code.innerText).then(done, done);
      } else {
        done();
      }
    });
  });

  document.querySelectorAll(".f-card").forEach(function (card) {
    card.addEventListener("mousemove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
    });
  });
})();
