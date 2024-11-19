let currentPRInfo = null;
let currentReviewResult = null;
let streamedContent = '';

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
  
  // 获取当前设置并初始化AI服务选择
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  
  // 初始化AI服务选择
  const aiServiceSelect = document.getElementById('ai-service');
  // 更新选项文本以显示实际配置的模型
  aiServiceSelect.innerHTML = `
    <option value="openai">OpenAI (${settings.openaiSettings?.model || 'gpt-4'})</option>
    <option value="anthropic">Anthropic (${settings.anthropicSettings?.model || 'claude-3-sonnet-20240229'})</option>
  `;
  // 设置默认值为配置中的选择
  aiServiceSelect.value = settings.aiService || 'openai';
  
  console.log('🤖 Set AI service to:', {
    service: aiServiceSelect.value,
    openaiModel: settings.openaiSettings?.model,
    anthropicModel: settings.anthropicSettings?.model
  });
  
  // 显示当前提示词
  const promptTextarea = document.getElementById('review-prompt');
  promptTextarea.value = settings.reviewSettings.reviewPrompt;
  
  // 自动调整文本框高度以适应内容
  adjustTextareaHeight(promptTextarea);
  
  // 监听文本框输入事件，动态调整高度
  promptTextarea.addEventListener('input', () => {
    adjustTextareaHeight(promptTextarea);
  });
  
  // 绑定按钮事件
  document.getElementById('start-review').addEventListener('click', startReview);
  document.getElementById('submit-review').addEventListener('click', submitReview);
  document.getElementById('toggle-prompt').addEventListener('click', togglePromptEditor);
});

// 添加自动调整文本框高度的函数
function adjustTextareaHeight(textarea) {
  // 重置高度
  textarea.style.height = 'auto';
  // 设置新高度
  textarea.style.height = Math.max(150, textarea.scrollHeight) + 'px';
}

// 切换提示词编辑器显示
function togglePromptEditor() {
  const promptSection = document.getElementById('prompt-section');
  const toggleBtn = document.getElementById('toggle-prompt');
  const promptTextarea = document.getElementById('review-prompt');
  
  if (promptSection.classList.contains('hidden')) {
    promptSection.classList.remove('hidden');
    toggleBtn.textContent = '隐藏提示词';
    // 显示时调整高度
    adjustTextareaHeight(promptTextarea);
  } else {
    promptSection.classList.add('hidden');
    toggleBtn.textContent = '显示提示词';
  }
}

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
  currentReviewResult = result;
  const container = document.getElementById('pr-info');
  
  // 创建结果容器
  const resultDiv = document.createElement('div');
  resultDiv.className = 'review-result';
  resultDiv.innerHTML = `
    <h2>审查结果</h2>
    <div id="review-content" class="review-content">${formatReviewContent(currentReviewResult.data.review)}</div>
    <div class="review-summary">
      <strong>统计信息:</strong>
      <ul>
        <li>审查文件数: ${currentReviewResult.data.files.length}</li>
        <li>代码增加: +${currentReviewResult.data.summary.additions}</li>
        <li>代码删除: -${currentReviewResult.data.summary.deletions}</li>
        <li>Token消耗: ${currentReviewResult.data.tokenUsage?.total || 'N/A'}</li>
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
    // 获取当前设置
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (!settings.githubToken) {
      alert('请先在选项页面配置GitHub Token');
      return;
    }

    // 获取当前选择的AI服务
    const selectedService = document.getElementById('ai-service').value;
    // 获取当前提示词
    const customPrompt = document.getElementById('review-prompt').value;
    
    // 检查选择的服务的API Key
    if (selectedService === 'openai' && !settings.openaiSettings?.apiKey) {
      alert('请先在选项页面配置OpenAI API Key');
      return;
    } else if (selectedService === 'anthropic' && !settings.anthropicSettings?.apiKey) {
      alert('请先在选项页面配置Anthropic API Key');
      return;
    }
    
    // 重置流式内容
    streamedContent = '';
    
    // 创建初始的审查结果显示
    const container = document.getElementById('pr-info');
    const resultDiv = document.createElement('div');
    resultDiv.className = 'review-result';
    resultDiv.innerHTML = `
      <h2>审查结果</h2>
      <div id="review-content" class="review-content"></div>
      <div class="review-summary">
        <strong>统计信息:</strong>
        <ul>
          <li>审查文件数: 加载中...</li>
          <li>代码增加: 加载中...</li>
          <li>代码删除: 加载中...</li>
          <li>Token消耗: 加载中...</li>
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
    
    // 发送审查请求，包含临时设置
    const result = await chrome.runtime.sendMessage({
      type: 'ANALYZE_PR',
      data: {
        ...currentPRInfo,
        tempSettings: {
          aiService: selectedService,
          reviewPrompt: customPrompt
        }
      }
    });
    
    if (result.success) {
      // 更新统计信息
      const summaryElement = container.querySelector('.review-summary');
      summaryElement.innerHTML = `
        <strong>统计信息:</strong>
        <ul>
          <li>审查文件数: ${result.data.files.length}</li>
          <li>代码增加: +${result.data.summary.additions}</li>
          <li>代码删除: -${result.data.summary.deletions}</li>
          <li>Token消耗: ${result.data.tokenUsage?.total || 'N/A'}</li>
        </ul>
      `;
      
      // 保存完整结果
      currentReviewResult = {
        data: {
          review: streamedContent,
          files: result.data.files,
          summary: result.data.summary,
          tokenUsage: result.data.tokenUsage
        }
      };
      
      // 显示提交评论按钮
      document.getElementById('review-actions').classList.remove('hidden');
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

// 更新审查显示
function updateReviewDisplay() {
  const container = document.getElementById('pr-info');
  
  // 创建结果容器
  const resultDiv = document.createElement('div');
  resultDiv.className = 'review-result';
  resultDiv.innerHTML = `
    <h2>审查结果</h2>
    <div id="review-content" class="review-content">${formatReviewContent(currentReviewResult.data.review)}</div>
    <div class="review-summary">
      <strong>统计信息:</strong>
      <ul>
        <li>审查文件数: ${currentReviewResult.data.files.length}</li>
        <li>代码增加: +${currentReviewResult.data.summary.additions}</li>
        <li>代码删除: -${currentReviewResult.data.summary.deletions}</li>
        <li>Token消耗: ${currentReviewResult.data.tokenUsage?.total || 'N/A'}</li>
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

// 提交��查评论
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

// 添加消息监听器处理流式更新
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'STREAM_UPDATE') {
    const { content, done } = message.data;
    const reviewElement = document.getElementById('review-content');
    
    if (reviewElement) {
      if (!done) {
        // 累积流式内容
        streamedContent += content;
        // 处理流式内容更新
        const formattedContent = formatReviewContent(content);
        reviewElement.innerHTML = formatReviewContent(streamedContent); // 显示完整的累积内容
      } else {
        // 处理完成事件
        console.log('Stream completed');
      }
    }
  }
});

// 格式化实时内容
function formatReviewContent(content) {
  return content
    .replace(/\n/g, '<br>')
    .replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
} 