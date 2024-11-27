// 默认设置
const DEFAULT_SETTINGS = {
  aiService: 'openai',
  openaiSettings: {
    apiKey: '',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4'
  },
  anthropicSettings: {
    apiKey: '',
    model: 'claude-3-sonnet-20240229'
  },
  reviewPrompt: `请用中文回复。作为代码审查员，请帮我检查以下代码：
1. 代码质量和最佳实践
2. 潜在的bug和安全问题
3. 性能优化建议
4. 可维护性和可读性改进

代码信息：
- 文件：{files}
- 变更：{diff}
- 语言：{language}
- 已有评论：{reviews}`,
  maxTokens: 1000,
  ignoreFiles: []
};

// 验证 API 设置
async function validateApiSettings(provider, apiKey) {
  if (provider === 'anthropic') {
    // 只做基本的格式验证
    if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
      throw new Error('Invalid Anthropic API key format');
    }
    return true;  // 如果格式正确就返回 true
  } else if (provider === 'openai') {
    // OpenAI 的验证逻辑保持不变
    if (!apiKey || apiKey.length < 20) {
      throw new Error('Invalid OpenAI API key format');
    }
    return true;
  }
  
  throw new Error('Unsupported AI service provider');
}

// 验证 GitHub Token
async function validateGitHubToken(token) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Token validation failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ GitHub Token is valid:', {
      username: data.login,
      tokenScopes: response.headers.get('x-oauth-scopes')
    });
    return true;
  } catch (error) {
    console.error('❌ GitHub Token validation failed:', error);
    return false;
  }
}

// 保存设置
async function saveOptions() {
  const settings = {
    githubToken: document.getElementById('githubToken').value,
    aiService: document.getElementById('aiService').value,
    openaiSettings: {
      apiKey: document.getElementById('openaiApiKey').value,
      apiEndpoint: document.getElementById('openaiApiEndpoint').value || DEFAULT_SETTINGS.openaiSettings.apiEndpoint,
      model: document.getElementById('openaiModel').value || DEFAULT_SETTINGS.openaiSettings.model
    },
    anthropicSettings: {
      apiKey: document.getElementById('anthropicApiKey').value,
      apiEndpoint: document.getElementById('anthropicApiEndpoint').value || DEFAULT_SETTINGS.anthropicSettings.apiEndpoint,
      model: document.getElementById('anthropicModel').value
    },
    reviewPrompt: document.getElementById('reviewPrompt').value,
    maxTokens: parseInt(document.getElementById('maxTokens').value, 10),
    ignoreFiles: document.getElementById('ignoreFiles').value
      .split('\n')
      .map(line => line.trim())
      .filter(line => line)
  };

  try {
    // 验证 GitHub Token
    if (settings.githubToken) {
      const isGithubValid = await validateGitHubToken(settings.githubToken);
      if (!isGithubValid) {
        showStatus('GitHub Token 无效或权限不足', 'error');
        return;
      }
    }

    // 验证当前选择的 AI 服务的设置
    const isApiValid = await validateApiSettings(settings.aiService, settings.openaiSettings.apiKey);
    if (!isApiValid) {
      showStatus('AI API 设置无效，请检查配置', 'error');
      return;
    }

    await chrome.storage.sync.set(settings);
    showStatus('设置已保存', 'success');
  } catch (error) {
    showStatus('保存失败: ' + error.message, 'error');
  }
}

// 加载设置
async function loadOptions() {
  const settings = await chrome.storage.sync.get(null);
  
  document.getElementById('githubToken').value = settings.githubToken || '';
  document.getElementById('aiService').value = settings.aiService || 'openai';
  
  // OpenAI 设置
  document.getElementById('openaiApiKey').value = settings.openaiSettings?.apiKey || '';
  document.getElementById('openaiApiEndpoint').value = settings.openaiSettings?.apiEndpoint || '';
  document.getElementById('openaiModel').value = settings.openaiSettings?.model || '';
  
  // Anthropic 设置
  document.getElementById('anthropicApiKey').value = settings.anthropicSettings?.apiKey || '';
  document.getElementById('anthropicApiEndpoint').value = settings.anthropicSettings?.apiEndpoint || '';
  document.getElementById('anthropicModel').value = settings.anthropicSettings?.model || DEFAULT_SETTINGS.anthropicSettings.model;
  
  // 审查设置
  document.getElementById('reviewPrompt').value = settings.reviewPrompt || DEFAULT_SETTINGS.reviewPrompt;
  document.getElementById('maxTokens').value = settings.maxTokens || DEFAULT_SETTINGS.maxTokens;
  document.getElementById('ignoreFiles').value = settings.ignoreFiles?.join('\n') || '';

  // 显示当前服务的设置
  toggleServiceSettings(settings.aiService || 'openai');
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadOptions();
  
  // 保存按钮事件
  document.getElementById('save').addEventListener('click', saveOptions);
  
  // 重置按钮事件
  document.getElementById('reset').addEventListener('click', resetOptions);
  
  // 数字输入验证
  document.getElementById('maxTokens').addEventListener('change', (e) => {
    validateInput(e.target);
  });
});

// 重置为默认设置
async function resetOptions() {
  document.getElementById('reviewPrompt').value = DEFAULT_SETTINGS.reviewPrompt;
  document.getElementById('maxTokens').value = DEFAULT_SETTINGS.maxTokens;
  document.getElementById('ignoreFiles').value = '';
  
  showStatus('已恢复默认设置，请点击保存', 'success');
}

// 显示状态消息
function showStatus(message, type = 'success') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status show ${type}`;
  
  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}

// 验证输入
function validateInput(input) {
  if (input.type === 'number') {
    const value = parseInt(input.value, 10);
    const min = parseInt(input.min, 10);
    const max = parseInt(input.max, 10);
    
    if (value < min) input.value = min;
    if (value > max) input.value = max;
  }
} 