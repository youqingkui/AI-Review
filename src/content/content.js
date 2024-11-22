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

function createContentContainer() {
  const container = document.createElement('div');
  container.id = 'ai-review-content';
  container.style.display = 'none';
  
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('src/popup/popup.html');
  container.appendChild(iframe);
  
  // 点击外部关闭
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target) && 
        !document.getElementById('ai-review-floating-btn').contains(e.target)) {
      container.style.display = 'none';
    }
  });
  
  // 添加窗口resize监听
  window.addEventListener('resize', () => {
    if (container.style.display !== 'none') {
      adjustContainerPosition(container);
    }
  });
  
  document.body.appendChild(container);
  return container;
}

// 新增：调整容器位置的函数
function adjustContainerPosition(container) {
  const button = document.getElementById('ai-review-floating-btn');
  if (!button) return;

  const buttonRect = button.getBoundingClientRect();
  const containerWidth = 400;
  
  // 计算最佳显示位置
  let left = buttonRect.right + 10;
  if (left + containerWidth > window.innerWidth) {
    left = buttonRect.left - containerWidth - 10;
  }
  
  // 计算top位置，确保不超出视窗
  let top = buttonRect.top;
  const containerHeight = container.offsetHeight;
  if (top + containerHeight > window.innerHeight) {
    top = window.innerHeight - containerHeight - 10;
  }
  
  container.style.left = `${Math.max(10, left)}px`;
  container.style.top = `${Math.max(10, top)}px`;
}

// 保存浮窗位置
async function saveButtonPosition(left, top) {
  await chrome.storage.local.set({
    'ai-review-button-position': { left, top }
  });
}

// 读取保存的位置
async function loadButtonPosition() {
  const result = await chrome.storage.local.get('ai-review-button-position');
  return result['ai-review-button-position'];
}

function createFloatingButton() {
  const button = document.createElement('div');
  button.id = 'ai-review-floating-btn';
  
  const iconUrl = chrome.runtime.getURL('assets/icons/icon48.png');
  button.innerHTML = `<img src="${iconUrl}" alt="AI Review">`;
  
  let isDragging = false;
  let startX, startY, initialX, initialY;

  // 设置初始位置
  button.style.position = 'fixed';
  
  // 读取保存的位置
  loadButtonPosition().then(position => {
    if (position) {
      button.style.left = `${position.left}px`;
      button.style.top = `${position.top}px`;
    } else {
      // 默认位置
      button.style.right = '20px';
      button.style.bottom = '20px';
    }
  });

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
    
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      isDragging = true;
    }
    
    if (isDragging) {
      const newX = initialX + deltaX;
      const newY = initialY + deltaY;
      
      const maxX = window.innerWidth - button.offsetWidth;
      const maxY = window.innerHeight - button.offsetHeight;
      
      const left = Math.min(Math.max(0, newX), maxX);
      const top = Math.min(Math.max(0, newY), maxY);
      
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
      // 移除right和bottom样式，避免冲突
      button.style.right = '';
      button.style.bottom = '';
    }
  }

  function onMouseUp(e) {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    
    if (isDragging) {
      // 保存新位置
      const rect = button.getBoundingClientRect();
      saveButtonPosition(rect.left, rect.top);
    } else {
      const container = document.getElementById('ai-review-content') 
        || createContentContainer();
      
      const newDisplay = container.style.display === 'none' ? 'block' : 'none';
      container.style.display = newDisplay;
      
      if (newDisplay === 'block') {
        adjustContainerPosition(container);
      }
    }
    isDragging = false;
  }

  button.addEventListener('mousedown', onMouseDown);
  document.body.appendChild(button);
}

// 确保在页面加载完成后创建按钮
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFloatingButton);
} else {
  createFloatingButton();
} 