/** 在沙箱 iframe 里执行一段 JS，返回捕获的 console 输出与返回值。
 *  用 sandbox iframe 而不是 eval：不共享页面的 DOM / localStorage，
 *  页面变量也拿不到；无限循环仍会卡住标签页（浏览器限制，无法真正掐断）。 */
export function runJsInSandbox(code: string, timeoutMs = 5000): Promise<string[]> {
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";

    const finish = (logs: string[]) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      iframe.remove();
      resolve(logs);
    };

    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      const d = e.data as { __logs?: string[]; __done?: boolean } | null;
      if (!d || typeof d !== "object") return;
      if (d.__done) finish(d.__logs ?? []);
    };

    window.addEventListener("message", onMsg);
    timer = window.setTimeout(() => finish(["（超时：执行超过 5 秒已中断）"]), timeoutMs);

    // srcdoc 里不能出现 </script>，调用方代码里的该序列先转义
    const safe = code.replace(new RegExp("</script", "gi"), "<\\/script");
    iframe.srcdoc = `<!doctype html><meta charset="utf-8"><script>
(function () {
  var logs = [];
  function fmt(args) {
    return Array.prototype.map.call(args, function (x) {
      if (typeof x === "string") return x;
      try { return JSON.stringify(x); } catch (e) { return String(x); }
    }).join(" ");
  }
  console.log = function () { logs.push(fmt(arguments)); };
  console.info = function () { logs.push(fmt(arguments)); };
  console.warn = function () { logs.push("⚠ " + fmt(arguments)); };
  console.error = function () { logs.push("✖ " + fmt(arguments)); };
  try {
    var result = (function () {
      "use strict";
      ${safe}
    })();
    if (result !== undefined) logs.push(fmt([result]));
  } catch (e) {
    logs.push("✖ " + (e && e.stack ? String(e.stack).split("\\n").slice(0, 3).join(" | ") : String(e)));
  }
  parent.postMessage({ __logs: logs, __done: true }, "*");
})();
</script>`;
  });
}
