(function () {
  "use strict";

  var CFG = window.PR_CONFIG || {};
  var BASE_RULE = "When this happens, make a DC 14 Wisdom save. On a failure you are frightened until the end of your next turn.";
  var QUESTIONS = [
    { p: "I know who you are. I know what keeps you up at night, like a constant trepidation humming in the deepest pit of your stomach. So tell me…what worries you?",
      a: ["Unbuttered toast on a warm evening", "The eyes of a tormented lover on a cold morning", "A vengeful narrator to my story", "I know not what bothers me, only that I am bothered"] },
    { p: "I met a man who wasn’t there. He wept and wept but nobody cared. This is the world we are doomed to bear. So why shan’t I welcome the despair?",
      a: ["I still have my love affair", "Because the man wasn’t there", "There is no story worth the fare", "I know not why I care"] },
    { p: "The children talk like they know what’s coming, and have a plan among themselves. It’s disheartening to be a puppet in someone else’s theatre of dreams and a toy in their ploy. But what can we do? We’re just a group of errant fools…or is there more to this?",
      a: ["Sing, sing, sing along to the whistles and hymns", "It will all be over soon", "I miss the days of yonder when things were normal", "I know not who I am, only what I am"] }
  ];

  var app = document.getElementById("app");
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var timers = { refresh: null, dice: null };
  var run = 0; // bumped on every route change so late responses from an old route are ignored

  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function show(node) { app.innerHTML = ""; app.appendChild(node); }
  function die(n, cls) { return h("div", { class: "die" + (cls ? " " + cls : ""), "aria-hidden": "true", text: String(n) }); }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function configured() {
    return CFG.url && CFG.key && CFG.url.indexOf("YOUR-") === -1 && CFG.key.indexOf("YOUR-") === -1;
  }

  function rpc(fn, args) {
    var headers = { "Content-Type": "application/json", apikey: CFG.key };
    // Legacy anon keys are JWTs and go in Authorization too. Newer publishable keys are not JWTs: apikey alone.
    if (/^eyJ/.test(CFG.key)) headers.Authorization = "Bearer " + CFG.key;
    return fetch(CFG.url.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST", headers: headers, body: JSON.stringify(args)
    }).then(function (r) {
      if (!r.ok) throw new Error("http-" + r.status);
      return r.json();
    });
  }

  function parseHash() {
    var m = /^(p|d)=([A-Za-z0-9]{20,100})(&fresh)?$/.exec(location.hash.replace(/^#/, ""));
    return m ? { mode: m[1], token: m[2] } : null;
  }

  function clearTimers() {
    if (timers.refresh) clearInterval(timers.refresh);
    if (timers.dice) clearInterval(timers.dice);
    timers.refresh = timers.dice = null;
  }

  /* ---------- shared screens ---------- */

  function shell(label, kids) {
    return h("section", { class: "stage" }, [
      h("div", { class: "who" }, [h("h1", { text: "Phobia Roll" }), label ? h("span", { class: "label", text: label }) : null])
    ].concat(kids));
  }

  function renderLanding(message) {
    var input = h("input", { id: "paste", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Paste your private link", placeholder: "Paste your link here" });
    var note = h("p", { class: "fine", text: "" });
    function open() {
      var v = input.value.trim();
      var m = /(p|d)=([A-Za-z0-9]{20,100})/.exec(v);
      if (m) { location.hash = m[1] + "=" + m[2]; return; }
      if (/^[A-Za-z0-9]{20,100}$/.test(v)) { location.hash = "p=" + v; return; }
      note.textContent = "That does not look like a link from the DM. Copy the whole message and try again.";
    }
    var kids = [
      h("p", { class: "msg", text: message }),
      h("div", { class: "paste" }, [input, h("button", { type: "button", class: "go", text: "Open", onclick: open }), note])
    ];
    show(shell("", kids));
  }

  function renderLoading() {
    show(shell("", [h("p", { class: "msg", text: "Loading…" })]));
  }

  function renderError(text, retry) {
    show(shell("", [
      h("p", { class: "msg", text: text }),
      h("button", { type: "button", class: "go", text: "Try again", onclick: retry })
    ]));
  }

  /* ---------- player ---------- */

  function startPlayer(token) {
    var my = ++run;
    renderLoading();
    rpc("pr_get", { p_token: token }).then(function (res) {
      if (my !== run) return;
      if (res === null) { renderLanding("This link is not recognised. Make sure you copied the whole link, or ask the DM to resend it."); return; }
      if (res.rolled) { renderResult(res); return; }
      renderQuestion(token, res.name, []);
    }).catch(function () {
      if (my !== run) return;
      renderError("Could not reach the server. Check your connection and try again.", function () { startPlayer(token); });
    });
  }

  function renderQuestion(token, name, answers) {
    var step = answers.length;
    if (step >= 3) { renderRollScreen(token, name, answers); return; }
    var q = QUESTIONS[step];
    var dots = h("div", { class: "dots", role: "img", "aria-label": "Question " + (step + 1) + " of 3" });
    for (var i = 0; i < 3; i++) dots.appendChild(h("span", { class: "dot", "data-on": String(i <= step) }));
    var opts = h("div", { class: "opts" });
    q.a.forEach(function (text, idx) {
      opts.appendChild(h("button", { type: "button", class: "opt", text: text, onclick: function () {
        renderQuestion(token, name, answers.concat([idx]));
      } }));
    });
    var kids = [dots, h("p", { class: "prompt", text: q.p }), opts];
    if (step > 0) kids.push(h("button", { type: "button", class: "link", text: "Back", onclick: function () { renderQuestion(token, name, answers.slice(0, -1)); } }));
    show(shell(name, kids));
  }

  function renderRollScreen(token, name, answers) {
    var dieEl = die(1);
    var btn = h("button", { type: "button", class: "go", text: "Roll the d4", onclick: function () { roll(); } });
    var note = h("p", { class: "fine", text: "" });
    show(shell(name, [h("div", { class: "die-wrap" }, [dieEl]), btn, note]));

    function roll() {
      var my = ++run;
      btn.disabled = true;
      note.textContent = "";
      var started = Date.now();
      if (!reduced) {
        dieEl.className = "die rolling";
        timers.dice = setInterval(function () { dieEl.textContent = String(1 + rnd(4)); }, 90);
      }
      var call = rpc("pr_roll", { p_token: token, p_answers: answers });
      var wait = reduced ? Promise.resolve() : delay(Math.max(0, 1400 - (Date.now() - started)));
      Promise.all([call, wait]).then(function (out) {
        if (timers.dice) { clearInterval(timers.dice); timers.dice = null; }
        if (my !== run) return;
        var res = out[0];
        if (res === null) { renderLanding("This link is not recognised. Make sure you copied the whole link, or ask the DM to resend it."); return; }
        if (res.error) { renderQuestion(token, name, []); return; }
        renderResult(res);
      }).catch(function () {
        if (timers.dice) { clearInterval(timers.dice); timers.dice = null; }
        if (my !== run) return;
        dieEl.className = "die";
        btn.disabled = false;
        note.textContent = "Could not reach the server. Your answers are kept. Try the roll again.";
      });
    }
  }

  function renderResult(res) {
    var r = res.result || { title: "", rule: "", custom: false };
    var rule = h("div", { class: "rule" }, [h("p", { text: r.rule })]);
    if (!r.custom) rule.appendChild(h("p", { class: "fine", text: BASE_RULE }));
    show(shell(res.name, [
      h("div", { class: "result" }, [
        die(res.slot),
        h("span", { class: "label", text: "Your phobia" }),
        h("p", { class: "phobia", text: r.title }),
        rule,
        h("p", { class: "fine", text: "This result is final." })
      ])
    ]));
  }

  /* ---------- DM ---------- */

  var dmState = { confirm: null, data: null, at: null };

  function startDM(token) {
    var my = ++run;
    renderLoading();
    function load(first) {
      return rpc("dm_get", { d_token: token }).then(function (res) {
        if (my !== run) return;
        if (res === null) { clearTimers(); renderLanding("This DM link is not recognised."); return; }
        dmState.data = res.players || [];
        dmState.at = new Date();
        renderDM(token, load);
      }).catch(function () {
        if (my !== run) return;
        if (first) renderError("Could not reach the server. If the project has been idle, open it in Supabase and unpause it, then try again.", function () { startDM(token); });
      });
    }
    load(true);
    timers.refresh = setInterval(function () {
      if (document.hidden) return;
      load(false);
    }, 20000);
  }

  function renderDM(token, reload) {
    var wrap = h("section", { class: "dm" });
    var time = dmState.at ? dmState.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    wrap.appendChild(h("div", { class: "dm-head" }, [
      h("h1", { text: "DM view" }),
      h("span", { class: "fine" }, ["Updated " + time + " "]),
      h("button", { type: "button", class: "mini", text: "Refresh", onclick: function () { reload(false); } })
    ]));
    dmState.data.forEach(function (p) {
      var rolled = p.roll != null;
      var card = h("div", { class: "card" });
      card.appendChild(h("div", { class: "card-top" }, [
        h("h2", { text: p.name }),
        h("span", { class: "chip", "data-s": rolled ? "rolled" : "waiting", text: rolled ? "Rolled" : "Not rolled" })
      ]));
      var opts = p.options || [];
      if (rolled) {
        var hit = opts.filter(function (o) { return o.slot === p.roll; })[0] || { title: "", rule: "" };
        card.appendChild(h("div", { class: "rolled-line" }, [
          die(p.roll),
          h("div", null, [h("strong", { text: hit.title }), h("span", { text: hit.rule })])
        ]));
        var lines = (p.answers || []).map(function (a, i) {
          var t = QUESTIONS[i] && QUESTIONS[i].a[a];
          return "Q" + (i + 1) + ": " + (t || "?");
        }).join("  •  ");
        if (lines) card.appendChild(h("p", { class: "small", text: lines }));
      }
      if (opts.length) {
        var ol = h("ol");
        opts.forEach(function (o) {
          ol.appendChild(h("li", { "data-hit": String(o.slot === p.roll) }, [o.title, h("span", { text: o.rule })]));
        });
        card.appendChild(h("details", null, [h("summary", { text: "All four options" }), ol]));
      }
      if (rolled) {
        var actions = h("div", { class: "row-actions" });
        if (dmState.confirm === p.slug) {
          actions.appendChild(h("button", { type: "button", class: "mini danger", text: "Confirm reset for " + p.name, onclick: function () {
            rpc("dm_reset", { d_token: token, p_slug: p.slug }).then(function () { dmState.confirm = null; reload(false); })
              .catch(function () { dmState.confirm = null; renderError("The reset did not go through. Try again.", function () { startDM(token); }); });
          } }));
          actions.appendChild(h("button", { type: "button", class: "mini", text: "Cancel", onclick: function () { dmState.confirm = null; renderDM(token, reload); } }));
        } else {
          actions.appendChild(h("button", { type: "button", class: "mini", text: "Reset " + p.name, onclick: function () { dmState.confirm = p.slug; renderDM(token, reload); } }));
        }
        card.appendChild(actions);
      }
      wrap.appendChild(card);
    });
    show(wrap);
  }

  /* ---------- router ---------- */

  function start() {
    clearTimers();
    run++;
    if (!configured()) {
      show(shell("", [h("p", { class: "msg", text: "This site is not set up yet. The Supabase address and key in config.js still need to be filled in." })]));
      return;
    }
    var r = parseHash();
    if (!r) { renderLanding("Open the private link the DM sent you. If tapping it does not work, paste it below."); return; }
    if (r.mode === "p") startPlayer(r.token); else startDM(r.token);
  }

  window.addEventListener("hashchange", start);
  start();
})();
