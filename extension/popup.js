document.querySelector("#show").addEventListener("click", async () => {
  const status = document.querySelector("#status");
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw Error("No active tab");
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "bt-show-panel",
    });
    if (!response?.ok) throw Error("No panel");
    window.close();
  } catch {
    status.textContent =
      "请打开 B 站视频页。刚安装或更新后，请先刷新视频页面。";
  }
});
