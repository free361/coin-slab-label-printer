/* 钱币标签工具的页面逻辑。
   录入的每条钱币保存在本机 data/coins.json。
   勾选后按 A4 排版。文字位置来自 docs/五铢-114.psd，标签宽高在此基础上各缩短 1 毫米。 */

(function () {
  "use strict";

  // 单张标签的毫米尺寸。原先与 PSD（543×254 像素、300dpi）一致，为 45.974×21.505。
  // 实际打印偏大，宽和高各缩短 1 毫米。行列和四周留白由下面的 plan() 按这个尺寸计算。
  var LABEL_W = 44.974;
  var LABEL_H = 20.505;
  var PAGE_W = 210;
  var PAGE_H = 297;
  // 左右至少留 6 毫米，上下至少留 12 毫米，避免家用打印机吃掉纸边。
  var MIN_X = 6;
  var MIN_Y = 12;

  var state = {
    coins: [],
    selected: new Set(),
    editingId: null,
    filter: "all",
    keyword: "",
    gap: 2,
    cut: true,
    queue: [],
  };

  var form = document.getElementById("form-coin");
  var listEl = document.getElementById("list");
  var toastTimer = 0;

  var FIELDS = [
    ["name", "钱币名称"],
    ["dynasty", "朝代"],
    ["feature", "版别"],
    ["code", "性质"],
    ["spec", "直径x厚度 重量"],
    ["era", "铸造年代"],
    ["year", "公元年"],
    ["serial", "编号"],
  ];

  function logError(where, err) {
    console.error("[标签工具]", where, err);
    var message = err && err.message ? err.message : String(err || "");
    showError(where + (message ? "：" + message : ""));
  }

  window.addEventListener("error", function (event) {
    logError("页面出错", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", function (event) {
    logError("操作失败", event.reason);
  });

  function toast(message) {
    var el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 3200);
  }

  function showError(message) {
    var bar = document.getElementById("error-bar");
    bar.hidden = false;
    bar.textContent = message;
  }

  function clearError() {
    var bar = document.getElementById("error-bar");
    bar.hidden = true;
    bar.textContent = "";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uid() {
    return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function textOf(id) {
    return document.getElementById(id).value.trim();
  }

  function setText(id, value) {
    document.getElementById(id).value = value || "";
  }

  function formatSpec(coin) {
    var diameter = (coin.diameter || "").trim();
    var thickness = (coin.thickness || "").trim();
    var weight = (coin.weight || "").trim();
    var size = "";
    if (diameter && thickness) size = diameter + "x" + thickness + "mm";
    else if (diameter) size = diameter + "mm";
    else if (thickness) size = thickness + "mm";
    var weightText = weight ? weight + "g" : "";
    return [size, weightText].filter(Boolean).join(" ");
  }

  function normalize(raw) {
    raw = raw || {};
    return {
      id: raw.id || uid(),
      name: String(raw.name || "").trim(),
      dynasty: String(raw.dynasty || "").trim(),
      feature: String(raw.feature || "").trim(),
      code: String(raw.code || "").trim(),
      serial: String(raw.serial || "").trim(),
      diameter: String(raw.diameter || "").trim(),
      thickness: String(raw.thickness || "").trim(),
      weight: String(raw.weight || "").trim(),
      era: String(raw.era || "").trim(),
      year: String(raw.year || "").trim(),
      note: String(raw.note || "").trim(),
      printed: !!raw.printed,
      createdAt: raw.createdAt || new Date().toISOString(),
    };
  }

  function coinFromForm() {
    return normalize({
      id: state.editingId || "",
      name: textOf("f-name"),
      dynasty: textOf("f-dynasty"),
      feature: textOf("f-feature"),
      code: textOf("f-code"),
      serial: textOf("f-serial"),
      diameter: textOf("f-diameter"),
      thickness: textOf("f-thickness"),
      weight: textOf("f-weight"),
      era: textOf("f-era"),
      year: textOf("f-year"),
      note: textOf("f-note"),
      printed: false,
    });
  }

  function fillForm(coin) {
    setText("f-name", coin.name);
    setText("f-dynasty", coin.dynasty);
    setText("f-feature", coin.feature);
    setText("f-code", coin.code);
    setText("f-serial", coin.serial);
    setText("f-diameter", coin.diameter);
    setText("f-thickness", coin.thickness);
    setText("f-weight", coin.weight);
    setText("f-era", coin.era);
    setText("f-year", coin.year);
    setText("f-note", coin.note);
  }

  function clearForm() {
    fillForm({});
    state.editingId = null;
    updateEditUI();
    renderLive();
  }

  function updateEditUI() {
    var banner = document.getElementById("edit-banner");
    var coin = state.coins.find(function (item) { return item.id === state.editingId; });
    banner.hidden = !coin;
    document.getElementById("edit-name").textContent = coin ? coin.name : "";
    document.getElementById("btn-save").textContent = coin ? "保存修改" : "保存这条";
  }

  function fieldValue(coin, key) {
    if (key === "spec") return formatSpec(coin);
    return (coin[key] || "").trim();
  }

  // 生成一张标签。legend 用来画出每个空的名字；打印只带真正填写的字。
  function labelHtml(coin, options) {
    var legend = options && options.legend;
    var cut = options && options.cut;
    var html = '<div class="label' + (cut ? " cut" : "") + '">';
    FIELDS.forEach(function (pair) {
      var key = pair[0];
      var value = legend ? pair[1] : fieldValue(coin, key);
      if (!value) return;
      var pt = key === "name" || key === "dynasty" ? "10" : (key === "serial" ? "5" : "6");
      html += '<div class="fit ' + key + '" data-pt="' + pt + '">' + esc(value) + "</div>";
    });
    html += "</div>";
    return html;
  }

  // 字太长就缩小，直到放进格子。缩到最小还放不下就告诉调用方。
  function fitAll(root) {
    var clipped = false;
    root.querySelectorAll(".fit").forEach(function (el) {
      var max = parseFloat(el.getAttribute("data-pt")) || 6;
      var min = max > 8 ? 6 : 4.5;
      var size = max;
      el.style.fontSize = size + "pt";
      if (!el.clientWidth) return;
      var guard = 0;
      while (el.scrollWidth > el.clientWidth + 1 && size > min && guard < 40) {
        size = Math.round((size - 0.25) * 100) / 100;
        el.style.fontSize = size + "pt";
        guard += 1;
      }
      if (el.scrollWidth > el.clientWidth + 1) clipped = true;
    });
    return clipped;
  }

  // 表单还是空的时候，右边示例用第一条已保存的钱币，避免空白。
  function previewCoin() {
    var coin = coinFromForm();
    var hasText = coin.name || coin.dynasty || coin.feature || coin.code || coin.serial ||
      coin.diameter || coin.thickness || coin.weight || coin.era || coin.year;
    if (!hasText && state.coins.length) return state.coins[0];
    return coin;
  }

  function renderLive() {
    var legendHost = document.getElementById("legend-label");
    var host = document.getElementById("live-label");
    legendHost.innerHTML = labelHtml(null, { legend: true, cut: state.cut });
    host.innerHTML = labelHtml(previewCoin(), { cut: state.cut });
    fitAll(legendHost);
    var clipped = fitAll(host);
    document.getElementById("clip-note").hidden = !clipped;
    scaleSamples();
  }

  // 两张示例跟着左边格子的宽度放大或缩小，打印尺寸不变。
  function scaleSamples() {
    document.querySelectorAll(".live-slot").forEach(function (slot) {
      var scaleWrap = slot.querySelector(".live-scale");
      var label = scaleWrap && scaleWrap.querySelector(".label");
      if (!label) return;
      var naturalW = label.offsetWidth;
      var naturalH = label.offsetHeight;
      if (!naturalW || !naturalH || !slot.clientWidth) return;
      var scale = slot.clientWidth / naturalW;
      scaleWrap.style.transform = "scale(" + scale + ")";
      slot.style.height = Math.ceil(naturalH * scale) + "px";
    });
  }

  function visibleCoins() {
    var keyword = state.keyword.trim();
    return state.coins.filter(function (coin) {
      if (state.filter === "todo" && coin.printed) return false;
      if (state.filter === "done" && !coin.printed) return false;
      if (!keyword) return true;
      var haystack = [coin.name, coin.dynasty, coin.feature, coin.code, coin.serial, coin.era, coin.year, coin.note].join(" ");
      return haystack.indexOf(keyword) !== -1;
    });
  }

  function selectedCoins() {
    return state.coins.filter(function (coin) { return state.selected.has(coin.id); });
  }

  function labelCount(coins) {
    return coins.length;
  }

  function renderList() {
    var coins = visibleCoins();
    if (!coins.length) {
      listEl.innerHTML = '<li class="empty">' +
        (state.coins.length ? "没有符合的钱币。" : "还没有钱币。在左边填写后点「保存这条」。") +
        "</li>";
    } else {
      listEl.innerHTML = coins.map(function (coin) {
        var spec = formatSpec(coin);
        var line1 = [coin.dynasty, coin.code, coin.serial].filter(Boolean).join(" · ");
        var line2 = [spec, coin.note].filter(Boolean).join(" · ");
        var tag = coin.printed
          ? '<span class="tag done">已打印</span>'
          : '<span class="tag todo">未打印</span>';
        return (
          '<li data-id="' + esc(coin.id) + '">' +
            '<input type="checkbox" ' + (state.selected.has(coin.id) ? "checked" : "") + ' aria-label="选择' + esc(coin.name) + '">' +
            '<div class="info"><strong>' + esc(coin.name || "未命名") + tag + "</strong>" +
              '<span class="sub">' + esc(line1 || "没有朝代和性质") + "</span>" +
              '<span class="sub">' + esc(line2 || "没有尺寸") + "</span></div>" +
            '<div class="row-actions">' +
              '<button type="button" class="btn btn-small" data-act="edit">修改</button>' +
              '<button type="button" class="btn btn-small" data-act="copy">复制</button>' +
            "</div></li>"
        );
      }).join("");
    }

    var chosen = selectedCoins();
    var sheets = plan(state.gap);
    var count = labelCount(chosen);
    var pages = count ? Math.ceil(count / sheets.perPage) : 0;
    document.getElementById("summary").textContent = state.coins.length
      ? "共 " + state.coins.length + " 条，选中 " + chosen.length + " 条，要印 " + count +
        " 张。按现在的间距，一张 A4 放 " + sheets.perPage + " 张" +
        (pages ? "，需要 " + pages + " 页。" : "。")
      : "保存后会出现在这里。数据写在本文件夹的 data\\coins.json。";

    var previewBtn = document.getElementById("btn-preview");
    previewBtn.disabled = count === 0;
    previewBtn.textContent = count ? "看排版并打印（" + count + " 张）" : "看排版并打印";
  }

  // 计算一页能放几列几行，并把整组标签摆在纸的正中。
  function plan(gap) {
    gap = Number(gap);
    if (!(gap >= 0)) gap = 2;
    var cols = Math.floor((PAGE_W - MIN_X * 2 + gap) / (LABEL_W + gap));
    var rows = Math.floor((PAGE_H - MIN_Y * 2 + gap) / (LABEL_H + gap));
    cols = Math.max(1, cols);
    rows = Math.max(1, rows);
    while (cols > 1 && (PAGE_W - (cols * LABEL_W + (cols - 1) * gap)) / 2 < MIN_X - 0.05) cols -= 1;
    while (rows > 1 && (PAGE_H - (rows * LABEL_H + (rows - 1) * gap)) / 2 < MIN_Y - 0.05) rows -= 1;
    var gridW = cols * LABEL_W + (cols - 1) * gap;
    var gridH = rows * LABEL_H + (rows - 1) * gap;
    return {
      cols: cols,
      rows: rows,
      perPage: cols * rows,
      marginX: (PAGE_W - gridW) / 2,
      marginY: (PAGE_H - gridH) / 2,
      gap: gap,
    };
  }

  function expand(coins) {
    return coins.slice();
  }

  function renderPreview() {
    var layout = plan(state.gap);
    var labels = expand(state.queue);
    var stage = document.getElementById("preview-stage");
    stage.innerHTML = "";
    if (!labels.length) {
      document.getElementById("preview-meta").textContent = "没有要打印的标签。请返回，先勾选。";
      return;
    }
    var pageCount = Math.ceil(labels.length / layout.perPage);
    document.getElementById("preview-meta").textContent =
      "共 " + labels.length + " 张标签，每页 " + layout.perPage + " 张（" +
      layout.cols + " 列 × " + layout.rows + " 行），一共 " + pageCount + " 页。" +
      "四周留白大约左右 " + layout.marginX.toFixed(0) + " 毫米、上下 " + layout.marginY.toFixed(0) + " 毫米。";

    for (var pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      var slice = labels.slice(pageIndex * layout.perPage, (pageIndex + 1) * layout.perPage);
      var slot = document.createElement("div");
      slot.className = "sheet-slot";
      var sheet = document.createElement("div");
      sheet.className = "sheet";
      sheet.style.padding = layout.marginY + "mm " + layout.marginX + "mm";
      sheet.style.gap = layout.gap + "mm";
      sheet.innerHTML = slice.map(function (coin) {
        return labelHtml(coin, { live: false, cut: state.cut });
      }).join("");
      // 用格子的实际宽度平分每一列，避免毫米换算差一丁点时，最后一张被挤到下一行。
      var labelWidth = "calc((100% - " + (layout.cols - 1) + " * " + layout.gap + "mm) / " + layout.cols + ")";
      sheet.querySelectorAll(".label").forEach(function (label) {
        label.style.width = labelWidth;
      });
      slot.appendChild(sheet);
      stage.appendChild(slot);
      if (pageCount > 1) {
        var no = document.createElement("div");
        no.className = "page-no no-print";
        no.textContent = "第 " + (pageIndex + 1) + " 页 / 共 " + pageCount + " 页";
        stage.appendChild(no);
      }
    }
    var clipped = fitAll(stage);
    if (clipped) {
      toast("有的字太长，纸上可能显示不全。请返回改短。");
    }
    scaleSheets();
  }

  function scaleSheets() {
    var stage = document.getElementById("preview-stage");
    var sheet = stage.querySelector(".sheet");
    if (!sheet) return;
    var naturalW = sheet.offsetWidth || 1;
    var naturalH = sheet.offsetHeight || 1;
    var scaleW = (stage.clientWidth - 32) / naturalW;
    var scaleH = (stage.clientHeight - 32) / naturalH;
    var scale = Math.min(1, scaleW, scaleH > 0 ? scaleH : scaleW);
    stage.querySelectorAll(".sheet-slot").forEach(function (slot) {
      var page = slot.querySelector(".sheet");
      page.style.transformOrigin = "top left";
      page.style.transform = "scale(" + scale + ")";
      slot.style.width = naturalW * scale + "px";
      slot.style.height = naturalH * scale + "px";
    });
  }

  function showEditor() {
    document.body.classList.add("mode-edit");
    document.body.classList.remove("mode-preview");
    document.getElementById("editor").hidden = false;
    document.getElementById("preview").hidden = true;
    scaleSamples();
  }

  function showPreview() {
    var chosen = selectedCoins();
    if (!chosen.length) {
      toast("先在右边勾选要打印的钱币。");
      return;
    }
    state.queue = chosen;
    document.body.classList.remove("mode-edit");
    document.body.classList.add("mode-preview");
    document.getElementById("editor").hidden = true;
    document.getElementById("preview").hidden = false;
    renderPreview();
    requestAnimationFrame(scaleSheets);
  }

  async function saveAll() {
    var response = await fetch("/api/coins", {
      method: "PUT",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(state.coins),
    });
    var data = {};
    try {
      data = await response.json();
    } catch (err) {
      data = {};
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "没能保存");
    }
    document.getElementById("save-state").textContent = "已保存到 data\\coins.json";
    clearError();
  }

  function rememberSettings() {
    localStorage.setItem("label-gap", String(state.gap));
    localStorage.setItem("label-cut", state.cut ? "1" : "0");
    localStorage.setItem("label-keep", document.getElementById("keep-series").checked ? "1" : "0");
  }

  function loadSettings() {
    var gap = Number(localStorage.getItem("label-gap") || "2");
    if ([2, 3, 4].indexOf(gap) === -1) gap = 2;
    state.gap = gap;
    state.cut = localStorage.getItem("label-cut") !== "0";
    document.getElementById("gap").value = String(state.gap);
    document.getElementById("cut").checked = state.cut;
    if (localStorage.getItem("label-keep") === "0") {
      document.getElementById("keep-series").checked = false;
    }
  }

  function pad2(number) {
    return number < 10 ? "0" + number : String(number);
  }

  function usedSerials(exceptId) {
    var used = {};
    state.coins.forEach(function (coin) {
      if (coin.id === exceptId) return;
      if (coin.serial) used[coin.serial] = true;
    });
    return used;
  }

  // 编号形如 2610300001：日期加四位顺序号，和已有编号对过，不会重复。
  function makeSerial(exceptId) {
    var used = usedSerials(exceptId);
    var now = new Date();
    var prefix = String(now.getFullYear()).slice(2) + pad2(now.getMonth() + 1) + pad2(now.getDate());
    var n = 1;
    var serial = prefix + "0001";
    while (used[serial] && n < 10000) {
      n += 1;
      serial = prefix + String(10000 + n).slice(1);
    }
    return serial;
  }

  function ensureSerial(coin) {
    var serial = (coin.serial || "").trim();
    var used = usedSerials(coin.id);
    if (serial && !used[serial]) {
      coin.serial = serial;
      return false;
    }
    coin.serial = makeSerial(coin.id);
    setText("f-serial", coin.serial);
    return true;
  }

  function findCoin(id) {
    return state.coins.find(function (coin) { return coin.id === id; });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var coin = coinFromForm();
    if (!coin.name) {
      toast("请先填写钱币名称。");
      document.getElementById("f-name").focus();
      return;
    }
    var serialFilled = ensureSerial(coin);
    if (state.editingId) {
      var index = state.coins.findIndex(function (item) { return item.id === state.editingId; });
      if (index === -1) {
        toast("这条已经不在列表里，改为新增一条。");
        state.editingId = null;
        updateEditUI();
      } else {
        coin.id = state.coins[index].id;
        coin.createdAt = state.coins[index].createdAt;
        coin.printed = state.coins[index].printed;
        state.coins[index] = coin;
        toast(serialFilled
          ? "已经改好了。编号是自动写上的，不会和别的重复。"
          : "已经改好了。还要改可以继续改，录新的请点「取消修改」。");
        renderList();
        renderLive();
        saveAll().catch(function (err) { logError("保存失败", err); });
        return;
      }
    }
    coin.id = uid();
    coin.createdAt = new Date().toISOString();
    coin.printed = false;
    state.coins.unshift(coin);
    state.selected.add(coin.id);
    renderList();
    if (document.getElementById("keep-series").checked) {
      setText("f-serial", makeSerial(null));
      toast(serialFilled
        ? "已保存，并勾上了。编号是自动写上的。表单里留着这条，下一条已经换成新编号。"
        : "已保存，并勾上了。表单里的字还留着，下一条已经换成新编号。");
      renderLive();
      document.getElementById("f-name").focus();
    } else {
      clearForm();
      toast(serialFilled ? "已保存，并勾上了。编号是自动写上的。" : "已保存，并勾上了。");
    }
    saveAll().catch(function (err) { logError("保存失败", err); });
  });

  document.getElementById("btn-clear").addEventListener("click", function () {
    clearForm();
    document.getElementById("f-name").focus();
  });

  document.getElementById("btn-cancel-edit").addEventListener("click", function () {
    clearForm();
  });

  form.addEventListener("input", function () {
    renderLive();
  });

  document.getElementById("keep-series").addEventListener("change", rememberSettings);

  listEl.addEventListener("change", function (event) {
    var box = event.target;
    if (!box.matches || !box.matches("input[type=checkbox]")) return;
    var id = box.closest("[data-id]").getAttribute("data-id");
    if (box.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderList();
  });

  listEl.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) return;
    var id = button.closest("[data-id]").getAttribute("data-id");
    var coin = findCoin(id);
    if (!coin) return;
    if (button.getAttribute("data-act") === "edit") {
      state.editingId = coin.id;
      fillForm(coin);
      updateEditUI();
      renderLive();
      document.getElementById("f-name").focus();
      window.scrollTo(0, 0);
    }
    if (button.getAttribute("data-act") === "copy") {
      state.editingId = null;
      fillForm(coin);
      updateEditUI();
      renderLive();
      document.getElementById("f-code").focus();
      toast("已复制到左边。改完点「保存这条」，会新增一条，原来的还在。");
      window.scrollTo(0, 0);
    }
  });

  document.getElementById("search").addEventListener("input", function (event) {
    state.keyword = event.target.value;
    renderList();
  });

  document.querySelectorAll(".chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.filter = chip.getAttribute("data-filter");
      document.querySelectorAll(".chip").forEach(function (item) {
        item.classList.toggle("active", item === chip);
      });
      renderList();
    });
  });

  document.getElementById("btn-all").addEventListener("click", function () {
    visibleCoins().forEach(function (coin) { state.selected.add(coin.id); });
    renderList();
  });

  document.getElementById("btn-none").addEventListener("click", function () {
    visibleCoins().forEach(function (coin) { state.selected.delete(coin.id); });
    renderList();
  });

  document.getElementById("btn-todo").addEventListener("click", function () {
    state.selected.clear();
    state.coins.forEach(function (coin) {
      if (!coin.printed) state.selected.add(coin.id);
    });
    renderList();
    toast(state.selected.size ? "已勾上还没打印的。" : "没有未打印的钱币。");
  });

  document.getElementById("btn-delete").addEventListener("click", function () {
    var chosen = selectedCoins();
    if (!chosen.length) {
      toast("先勾选要删除的钱币。");
      return;
    }
    var tip = chosen.length === 1
      ? "确定删掉「" + chosen[0].name + "」吗？删了就要从备份里才能找回来。"
      : "确定删掉选中的 " + chosen.length + " 条吗？上一份备份在 data\\coins.bak.json。";
    if (!window.confirm(tip)) return;
    var drop = new Set(chosen.map(function (coin) { return coin.id; }));
    state.coins = state.coins.filter(function (coin) { return !drop.has(coin.id); });
    drop.forEach(function (id) { state.selected.delete(id); });
    if (drop.has(state.editingId)) clearForm();
    renderList();
    saveAll().then(function () { toast("已删除。"); }).catch(function (err) { logError("删除后保存失败", err); });
  });

  function markPrinted(printed) {
    var chosen = selectedCoins();
    if (!chosen.length) {
      toast("先勾选钱币。");
      return;
    }
    chosen.forEach(function (coin) { coin.printed = printed; });
    renderList();
    saveAll()
      .then(function () { toast(printed ? "已标成打印过了。" : "已改回未打印。"); })
      .catch(function (err) { logError("标记失败", err); });
  }

  document.getElementById("btn-mark-done").addEventListener("click", function () { markPrinted(true); });
  document.getElementById("btn-mark-undo").addEventListener("click", function () { markPrinted(false); });

  document.getElementById("btn-export").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(state.coins, null, 2)], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "钱币标签备份.json";
    link.click();
    URL.revokeObjectURL(link.href);
    toast("备份文件已下载。请把它存到别处。");
  });

  document.getElementById("btn-import").addEventListener("click", function () {
    document.getElementById("file-import").click();
  });

  document.getElementById("file-import").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(String(reader.result || ""));
      } catch (err) {
        toast("这个文件不是备份。");
        return;
      }
      var list = Array.isArray(data) ? data : data.coins;
      if (!Array.isArray(list)) {
        toast("备份里没有钱币列表。");
        return;
      }
      if (!window.confirm("用这份备份替换现在的 " + state.coins.length + " 条吗？现在的会先留一份在 data\\coins.bak.json。")) return;
      state.coins = list.map(normalize).filter(function (coin) { return coin.name; });
      state.selected = new Set();
      state.editingId = null;
      updateEditUI();
      renderList();
      renderLive();
      saveAll()
        .then(function () { toast("已恢复 " + state.coins.length + " 条。"); })
        .catch(function (err) { logError("恢复失败", err); });
    };
    reader.readAsText(file, "utf-8");
  });

  document.getElementById("btn-preview").addEventListener("click", showPreview);
  document.getElementById("btn-back").addEventListener("click", function () {
    showEditor();
    renderLive();
  });

  document.getElementById("gap").addEventListener("change", function (event) {
    state.gap = Number(event.target.value);
    rememberSettings();
    renderPreview();
    renderList();
  });

  document.getElementById("cut").addEventListener("change", function (event) {
    state.cut = event.target.checked;
    rememberSettings();
    renderPreview();
    renderLive();
  });

  // 豆包那只猫是浏览器钉在屏幕上的，打印时会被当成页面内容。打印前先把这种浮动图标藏起来。
  var floatingSaved = null;

  function classText(el) {
    if (!el.className) return "";
    return typeof el.className === "string" ? el.className : "";
  }

  function hideNode(el, saved) {
    saved.push([el, el.getAttribute("style")]);
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("position", "static", "important");
  }

  function looksLikeFloatingIcon(el) {
    var hint = ((el.id || "") + " " + classText(el)).toLowerCase();
    return /doubao|豆包|bytedance|assistant|float-ball|sidebar-entry/.test(hint);
  }

  function silenceFloating(view, root) {
    var saved = [];
    var scope = root.body || root;
    function visit(node) {
      var list = node.querySelectorAll ? node.querySelectorAll("*") : [];
      for (var i = 0; i < list.length; i += 1) {
        var el = list[i];
        if (el.closest && el.closest(".sheet")) continue;
        var pos = "";
        try { pos = view.getComputedStyle(el).position; } catch (err) { continue; }
        if (pos === "fixed" || pos === "sticky" || looksLikeFloatingIcon(el)) hideNode(el, saved);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    }
    visit(scope);
    var top = root.documentElement || null;
    if (top) {
      Array.from(top.children).forEach(function (el) {
        if (el.tagName === "HEAD" || el.tagName === "BODY") return;
        hideNode(el, saved);
      });
    }
    return saved;
  }

  function silencePageFloating() {
    if (floatingSaved) return;
    floatingSaved = silenceFloating(window, document);
  }

  function restoreFloating() {
    if (!floatingSaved) return;
    floatingSaved.forEach(function (pair) {
      if (pair[1] == null) pair[0].removeAttribute("style");
      else pair[0].setAttribute("style", pair[1]);
    });
    floatingSaved = null;
  }

  function sheetMarkup() {
    var parts = [];
    document.querySelectorAll("#preview-stage .sheet").forEach(function (sheet) {
      var clone = sheet.cloneNode(true);
      clone.style.transform = "none";
      clone.style.width = "210mm";
      clone.style.height = "297mm";
      clone.style.boxShadow = "none";
      parts.push(clone.outerHTML);
    });
    return parts.join("");
  }

  function askMarkPrinted() {
    if (window.confirm("如果已经打印出来了，点「确定」，把这几条标成已打印。\n还没打、或打坏了，点「取消」。")) {
      state.queue.forEach(function (coin) { coin.printed = true; });
      renderList();
      saveAll().catch(function (err) { logError("标记已打印失败", err); });
    }
  }

  document.getElementById("btn-print").addEventListener("click", function () {
    var markup = sheetMarkup();
    if (!markup) {
      toast("没有要打印的纸。");
      return;
    }
    // 用一张干净的空白页来印，不把当前屏幕上的小猫、按钮带进去。
    silencePageFloating();
    var iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    var doc = iframe.contentDocument;
    var cssHref = new URL("style.css", location.href).href;
    doc.open();
    doc.write(
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>打印标签</title>" +
      "<link rel=\"stylesheet\" href=\"" + cssHref + "\">" +
      "<style>" +
      "@page{size:A4 portrait;margin:0;}" +
      "html,body{margin:0;padding:0;background:#fff;}" +
      "html body > :not(.sheet){display:none !important;visibility:hidden !important;position:static !important;}" +
      ".sheet{box-shadow:none !important;margin:0 !important;break-after:page;page-break-after:always;}" +
      ".sheet:last-child{break-after:auto;page-break-after:auto;}" +
      "</style></head><body>" + markup + "</body></html>"
    );
    doc.close();

    function purgeFrame() {
      if (!doc.body) return;
      Array.from(doc.body.children).forEach(function (el) {
        if (!el.classList || !el.classList.contains("sheet")) {
          el.style.setProperty("display", "none", "important");
          el.style.setProperty("visibility", "hidden", "important");
          el.style.setProperty("position", "static", "important");
        }
      });
      silenceFloating(iframe.contentWindow, doc);
    }
    purgeFrame();
    var observer = new MutationObserver(purgeFrame);
    observer.observe(doc.documentElement, { childList: true, subtree: true });

    function runPrint() {
      purgeFrame();
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      observer.disconnect();
      restoreFloating();
      iframe.remove();
      askMarkPrinted();
    }

    var link = doc.querySelector("link");
    var start = function () {
      var ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
      ready.then(runPrint).catch(runPrint);
    };
    if (link && !link.sheet) {
      link.onload = start;
      link.onerror = start;
    } else {
      start();
    }
  });

  // 有人直接按 Ctrl+P 时，同样先藏起屏幕上的浮动图标，只留准备好的纸。
  window.addEventListener("beforeprint", function () {
    if (document.getElementById("print-frame")) return;
    silencePageFloating();
    document.body.classList.add("printing");
  });
  window.addEventListener("afterprint", function () {
    document.body.classList.remove("printing");
    restoreFloating();
  });

  window.addEventListener("resize", function () {
    if (document.body.classList.contains("mode-preview")) scaleSheets();
    else scaleSamples();
  });

  async function init() {
    if (location.protocol === "file:") {
      showError("请不要直接双击打开这个网页。请回到文件夹，双击「启动标签工具.bat」。");
      return;
    }
    loadSettings();
    try {
      var response = await fetch("/api/coins");
      var data = await response.json();
      state.coins = (data.coins || []).map(normalize).filter(function (coin) { return coin.name; });
      if (data.warning) showError(data.warning);
      document.getElementById("save-state").textContent = "数据在 data\\coins.json，关闭网页也不会丢。";
    } catch (err) {
      logError("读取已保存的钱币失败", err);
      document.getElementById("save-state").textContent = "没读到数据";
    }
    renderList();
    renderLive();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        renderLive();
        if (document.body.classList.contains("mode-preview")) renderPreview();
      });
    }
  }

  init();
})();
