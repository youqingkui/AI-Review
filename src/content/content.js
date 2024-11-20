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

function createFloatingButton() {
  const button = document.createElement('div');
  button.id = 'cubox-floating-btn';
  
  button.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 4L10.59 5.41L16.17 11H4V13H16.17L10.59 18.59L12 20L20 12L12 4Z" fill="white"/>
    </svg>
  `;
  
  let isDragging = false;
  let startX, startY, initialX, initialY;

  function onMouseDown(e) {
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    const rect = button.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    isDragging = false;
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    e.preventDefault();
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    
    // 如果移动超过5px才认为是拖拽
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      isDragging = true;
    }
    
    if (isDragging) {
      const newX = initialX + deltaX;
      const newY = initialY + deltaY;
      
      // 确保不超出视窗
      const maxX = window.innerWidth - button.offsetWidth;
      const maxY = window.innerHeight - button.offsetHeight;
      
      button.style.left = `${Math.min(Math.max(0, newX), maxX)}px`;
      button.style.top = `${Math.min(Math.max(0, newY), maxY)}px`;
    }
  }

  function onMouseUp(e) {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    
    if (!isDragging) {
      console.log('Button clicked, opening popup...');
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    }
    isDragging = false;
  }

  // 添加事件监听器
  button.addEventListener('mousedown', onMouseDown);
  
  // 设置初始位置
  button.style.position = 'fixed';
  button.style.right = '20px';
  button.style.bottom = '20px';
  
  document.body.appendChild(button);
}

// 确保在页面加载完成后创建按钮
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFloatingButton);
} else {
  createFloatingButton();
} 