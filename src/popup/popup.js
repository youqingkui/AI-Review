let currentPRInfo = null;
let currentReviewResult = null;

// 初始化popup
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab.url.includes('github.com') && tab.url.includes('/pull/')) {
    // 在PR页面
    document.getElementById('pr-info').classList.remove('hidden');
    document.getElementById('no-pr').classList.add('hidden');
    
    // 获取PR信息
    chrome.tabs.sendMessage(tab.id, { type: 'GET_PR_INFO' }, (response) => {
      if (response) {
        displayPRInfo(response);
        currentPRInfo = response;
      }
    });
  } else {
    // 不在PR页面
    document.getElementById('pr-info').classList.add('hidden');
    document.getElementById('no-pr').classList.remove('hidden');
  }
  
  // 绑定按钮事件
  document.getElementById('start-review').addEventListener('click', startReview);
  document.getElementById('submit-review').addEventListener('click', submitReview);
});

// 显示PR信息
function displayPRInfo(prInfo) {
  const prDetails = document.getElementById('pr-details');
  prDetails.innerHTML = `
    <div class="pr-detail-item">
      <strong>仓库:</strong> ${prInfo.owner}/${prInfo.repo}
    </div>
    <div class="pr-detail-item">
      <strong>PR编号:</strong> #${prInfo.prNumber}
    </div>
    <div class="pr-detail-item">
      <strong>标题:</strong> ${prInfo.title || '加载中...'}
    </div>
    <div class="pr-detail-item">
      <strong>变更文件:</strong> ${prInfo.changedFiles?.length || '加载中...'}个
    </div>
  `;
}

// 显示审查结果
function displayReviewResult(result) {
  currentReviewResult = result; // 保存审查结果
  const container = document.getElementById('pr-info');
  
  // 创建结果容器
  const resultDiv = document.createElement('div');
  resultDiv.className = 'review-result';
  resultDiv.innerHTML = `
    <h2>审查结果</h2>
    <div class="review-content">${formatReviewContent(result.data.review)}</div>
    <div class="review-summary">
      <strong>统计信息:</strong>
      <ul>
        <li>审查文件数: ${result.data.files.length}</li>
        <li>代码增加: +${result.data.summary.additions}</li>
        <li>代码删除: -${result.data.summary.deletions}</li>
      </ul>
    </div>
  `;
  
  // 移除旧的结果（如果存在）
  const oldResult = container.querySelector('.review-result');
  if (oldResult) {
    oldResult.remove();
  }
  
  // 添加新结果
  container.appendChild(resultDiv);

  // 显示提交评论按钮
  document.getElementById('review-actions').classList.remove('hidden');
}

// 格式化审查内容
function formatReviewContent(content) {
  return content
    .replace(/\n/g, '<br>')
    .replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

// 开始代码审查
async function startReview() {
  if (!currentPRInfo) return;
  
  const button = document.getElementById('start-review');
  button.disabled = true;
  button.textContent = '审查中...';
  
  try {
    // 检查配置
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (!settings.githubToken) {
      alert('请先在选项页面配置GitHub Token');
      return;
    }

    // 根据选择的服务检查对应的API Key
    if (settings.aiService === 'openai' && !settings.openaiSettings?.apiKey) {
      alert('请先在选项页面配置OpenAI API Key');
      return;
    } else if (settings.aiService === 'anthropic' && !settings.anthropicSettings?.apiKey) {
      alert('请先在选项页面配置Anthropic API Key');
      return;
    }
    
    // 发送审查请求
    const result = await chrome.runtime.sendMessage({
      type: 'ANALYZE_PR',
      data: currentPRInfo
    });
    
    if (result.success) {
      displayReviewResult(result);
    } else {
      alert(`审查失败: ${result.error}`);
    }
    
  } catch (error) {
    console.error('Review failed:', error);
    alert('审查失败，请检查配置并重试');
  } finally {
    button.disabled = false;
    button.textContent = '开始审查';
  }
}

// 提交审查评论
async function submitReview() {
  if (!currentPRInfo || !currentReviewResult) return;

  const button = document.getElementById('submit-review');
  button.disabled = true;
  button.textContent = '提交中...';

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'SUBMIT_REVIEW',
      data: {
        prInfo: currentPRInfo,
        review: currentReviewResult.data.review
      }
    });

    if (result.error) {
      throw new Error(result.error);
    }

    button.textContent = '评论已提交';
    setTimeout(() => {
      button.textContent = '提交审查评论';
      button.disabled = false;
    }, 2000);

  } catch (error) {
    console.error('Failed to submit review:', error);
    alert('提交评论失败: ' + error.message);
    button.textContent = '提交审查评论';
    button.disabled = false;
  }
} 