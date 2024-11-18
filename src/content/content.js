// 检测是否在PR页面
function isPRPage() {
  return window.location.pathname.includes('/pull/');
}

// 从URL解析PR信息
function parsePRUrl() {
  const urlParts = window.location.pathname.split('/');
  return {
    owner: urlParts[1],
    repo: urlParts[2],
    prNumber: urlParts[4]
  };
}

// 获取PR信息
async function getPRInfo() {
  if (!isPRPage()) return null;
  
  const { owner, repo, prNumber } = parsePRUrl();
  console.log('📦 PR Info:', { owner, repo, prNumber });
  
  try {
    // 发送消息给background script获取PR详细信息
    console.log('🔍 Fetching PR details...');
    const prDetails = await chrome.runtime.sendMessage({
      type: 'GET_PR_DETAILS',
      data: { owner, repo, prNumber }
    });

    if (prDetails.error) {
      console.error('❌ Error fetching PR details:', prDetails.error);
      return null;
    }

    console.log('✅ PR details fetched:', prDetails);
    return {
      owner,
      repo,
      prNumber,
      ...prDetails,
      url: window.location.href
    };
  } catch (error) {
    console.error('❌ Failed to get PR info:', error);
    return null;
  }
}

// 监听页面变化
let currentPRUrl = null;
async function checkPRPage() {
  if (isPRPage()) {
    const currentUrl = window.location.pathname;
    if (currentUrl !== currentPRUrl) {
      console.log('🔄 PR page changed:', currentUrl);
      currentPRUrl = currentUrl;
      const prInfo = await getPRInfo();
      if (prInfo) {
        console.log('📢 Sending PR_DETECTED message:', prInfo);
        chrome.runtime.sendMessage({
          type: 'PR_DETECTED',
          data: prInfo
        });
      }
    }
  }
}

// 初始检查和设置MutationObserver
checkPRPage();
new MutationObserver(() => {
  if (window.location.pathname !== currentPRUrl) {
    checkPRPage();
  }
}).observe(document.body, {
  childList: true,
  subtree: true
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_PR_INFO') {
    getPRInfo().then(sendResponse);
    return true;
  }
}); 