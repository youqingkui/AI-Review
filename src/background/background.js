// 默认设置
const DEFAULT_SETTINGS = {
  aiService: 'openai',
  openaiSettings: {
    apiKey: '',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o'
  },
  anthropicSettings: {
    apiKey: '',
    model: 'claude-3-sonnet'
  },
  reviewSettings: {
    reviewPrompt: `请用中文回复。作为代码审查员，请帮我检查以下代码：
1. 代码质量和最佳实践
2. 潜在的bug和安全问题
3. 性能优化建议
4. 可维护性和可读性改进

代码信息：
- 文件：{files}
- 变更：{diff}
- 语言：{language}`,
    maxTokens: 1000,
    ignoreFiles: []
  }
};

// 监听安装事件
chrome.runtime.onInstalled.addListener(async (details) => {
  // 获取现有配置
  const existingSettings = await chrome.storage.sync.get(null);
  
  // 根据不同的安装类型处理
  switch (details.reason) {
    case 'install':
      // 全新安装，使用默认配置
      console.log('🆕 New installation, applying default settings');
      await chrome.storage.sync.set(DEFAULT_SETTINGS);
      break;
      
    case 'update':
      // 更新插件，保留现有配置，只添加新的默认值
      console.log('🔄 Extension updated, merging settings');
      const mergedSettings = {
        ...DEFAULT_SETTINGS,
        ...existingSettings,
        // 确保子对象也被正确合并
        openaiSettings: {
          ...DEFAULT_SETTINGS.openaiSettings,
          ...existingSettings.openaiSettings
        },
        anthropicSettings: {
          ...DEFAULT_SETTINGS.anthropicSettings,
          ...existingSettings.anthropicSettings
        },
        reviewSettings: {
          ...DEFAULT_SETTINGS.reviewSettings,
          ...existingSettings.reviewSettings
        }
      };
      
      // 保留原有的 token 和 key
      if (existingSettings.githubToken) {
        mergedSettings.githubToken = existingSettings.githubToken;
      }
      if (existingSettings.openaiSettings?.apiKey) {
        mergedSettings.openaiSettings.apiKey = existingSettings.openaiSettings.apiKey;
      }
      if (existingSettings.anthropicSettings?.apiKey) {
        mergedSettings.anthropicSettings.apiKey = existingSettings.anthropicSettings.apiKey;
      }

      console.log('📝 Merged settings:', {
        hasGithubToken: !!mergedSettings.githubToken,
        hasOpenAIKey: !!mergedSettings.openaiSettings.apiKey,
        hasAnthropicKey: !!mergedSettings.anthropicSettings.apiKey,
        aiService: mergedSettings.aiService
      });

      await chrome.storage.sync.set(mergedSettings);
      break;
      
    case 'chrome_update':
    case 'shared_module_update':
      // 浏览器更新，不需要修改配置
      console.log('🔄 Browser updated, keeping existing settings');
      break;
  }
});

// GitHub API 请求封装
async function githubRequest(endpoint, token) {
  console.log('🚀 GitHub API Request:', {
    endpoint,
    tokenExists: !!token,  // 只打印token是否存在，不打印具体值
    tokenLength: token?.length
  });

  if (!token) {
    throw new Error('GitHub Token is missing or invalid');
  }

  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`,  // 修改为 Bearer 认证
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  
  if (!response.ok) {
    console.error('❌ GitHub API Error:', {
      status: response.status,
      statusText: response.statusText,
      endpoint,
      response: await response.text()  // 添加响应内容以便调试
    });
    throw new Error(`GitHub API error: ${response.status} - ${response.statusText}`);
  }
  
  const data = await response.json();
  console.log('✅ GitHub API Response:', { 
    endpoint,
    dataPreview: JSON.stringify(data).slice(0, 200) + '...'  // 只显示部分响应数据
  });
  return data;
}

// 获取PR详细信息
async function getPRDetails({ owner, repo, prNumber }) {
  const settings = await getSettings();
  const token = settings.githubToken;
  
  console.log('🔑 Getting PR details with token:', {
    tokenExists: !!token,
    tokenLength: token?.length,
    owner,
    repo,
    prNumber
  });

  if (!token) {
    throw new Error('GitHub token not configured. Please set it in the options page.');
  }

  try {
    // 并行获取PR信息和文件变更
    const [prData, files] = await Promise.all([
      // 获取PR基本信息
      githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, token),
      // 获取PR文件变更
      githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/files`, token)
    ]);

    return {
      title: prData.title,
      description: prData.body || '',
      baseBranch: prData.base.ref,
      headBranch: prData.head.ref,
      changedFiles: files.map(file => ({
        name: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
        blob_url: file.blob_url
      })),
      commits: prData.commits,
      additions: prData.additions,
      deletions: prData.deletions,
      changed_files: prData.changed_files
    };
  } catch (error) {
    console.error('❌ Failed to get PR details:', {
      error: error.message,
      owner,
      repo,
      prNumber
    });
    throw error;
  }
}

// AI API调用封装
async function callAIAPI(prompt, settings) {
  const service = settings.aiService;
  let apiKey, endpoint, model, headers, body;

  console.log('🤖 Preparing AI API call:', {
    service: service,
    useDefaultEndpoint: service === 'openai' ? 
      settings.openaiSettings.apiEndpoint === DEFAULT_SETTINGS.openaiSettings.apiEndpoint : 
      'N/A',
    useDefaultModel: service === 'openai' ? 
      settings.openaiSettings.model === DEFAULT_SETTINGS.openaiSettings.model :
      settings.anthropicSettings.model === DEFAULT_SETTINGS.anthropicSettings.model
  });

  switch (service) {
    case 'openai':
      apiKey = settings.openaiSettings.apiKey;
      endpoint = settings.openaiSettings.apiEndpoint || DEFAULT_SETTINGS.openaiSettings.apiEndpoint;
      model = settings.openaiSettings.model || DEFAULT_SETTINGS.openaiSettings.model;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };
      body = {
        model: model,
        messages: [
          { role: 'system', content: '你是一个专业的代码审查员，请用中文回复。' },
          { role: 'user', content: prompt }
        ],
        max_tokens: settings.reviewSettings.maxTokens,
        temperature: 0.7
      };
      break;

    case 'anthropic':
      apiKey = settings.anthropicSettings.apiKey;
      endpoint = 'https://api.anthropic.com/v1/messages';
      model = settings.anthropicSettings.model;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01'
      };
      body = {
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: settings.reviewSettings.maxTokens,
        temperature: 0.7
      };
      break;

    default:
      throw new Error('Unsupported AI service');
  }

  console.log('🚀 Calling AI API:', {
    service: service,
    endpoint: endpoint,
    model: model,
    maxTokens: settings.reviewSettings.maxTokens,
    promptLength: prompt.length,
    promptPreview: prompt
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    console.error('❌ AI API Error:', {
      service: service,
      status: response.status,
      statusText: response.statusText,
      response: await response.text()
    });
    throw new Error(`AI API error: ${response.status} - ${response.statusText}`);
  }

  const data = await response.json();
  const content = service === 'anthropic' 
    ? data.content[0].text 
    : data.choices[0].message.content;

  console.log('✅ AI API Response:', {
    service: service,
    model: model,
    responseLength: content.length,
    contentPreview: content.substring(0, 100) + '...',
    rawResponse: data // 添加完整的原始响应，方便调试
  });

  return content;
}

// 生成审查提示词
function generateReviewPrompt(prDetails, settings) {
  const filesList = prDetails.changedFiles
    .map(file => `${file.name} (${file.status}: +${file.additions} -${file.deletions})`)
    .join('\n');

  const diffs = prDetails.changedFiles
    .map(file => `=== ${file.name} ===\n${file.patch || ''}`)
    .join('\n\n');

  // 获取主要的编程语言
  const languages = new Set(
    prDetails.changedFiles
      .map(file => file.name.split('.').pop())
      .filter(ext => ext)
  );

  return settings.reviewSettings.reviewPrompt
    .replace('{files}', filesList)
    .replace('{diff}', diffs)
    .replace('{language}', Array.from(languages).join(', '));
}

// PR分析处理
async function handlePRAnalysis(prData) {
  console.log('🔍 Starting PR Analysis:', {
    ...prData,
    timestamp: new Date().toISOString()
  });
  
  const settings = await getSettings();
  console.log('📝 Using AI Service:', {
    service: settings.aiService,
    model: settings.aiService === 'openai' 
      ? settings.openaiSettings?.model || DEFAULT_SETTINGS.openaiSettings.model
      : settings.anthropicSettings?.model
  });
  
  // 修改配置检查逻辑
  if (!settings.githubToken) {
    throw new Error('GitHub Token未配置');
  }

  // 根据选择的服务检查对应的API Key
  if (settings.aiService === 'openai' && !settings.openaiSettings?.apiKey) {
    throw new Error('OpenAI API Key未置');
  } else if (settings.aiService === 'anthropic' && !settings.anthropicSettings?.apiKey) {
    throw new Error('Anthropic API Key未配置');
  }

  try {
    // 获取完整的PR信息
    console.log('📦 Fetching PR Details...');
    const prDetails = await getPRDetails({
      owner: prData.owner,
      repo: prData.repo,
      prNumber: prData.prNumber
    });

    // 过滤忽略的文件
    const ignorePatterns = settings.reviewSettings.ignoreFiles;
    console.log('🔍 Filtering files:', {
      total: prDetails.changedFiles.length,
      ignorePatterns
    });
    
    prDetails.changedFiles = prDetails.changedFiles.filter(file => {
      const shouldIgnore = ignorePatterns.some(pattern => {
        if (pattern.startsWith('*.')) {
          return file.name.endsWith(pattern.slice(1));
        }
        return file.name === pattern;
      });
      if (shouldIgnore) {
        console.log('⏭️ Ignoring file:', file.name);
      }
      return !shouldIgnore;
    });

    console.log('📝 Files to review:', {
      count: prDetails.changedFiles.length,
      files: prDetails.changedFiles.map(f => f.name)
    });

    if (prDetails.changedFiles.length === 0) {
      throw new Error('没有需要审查的文件');
    }

    // 成审查提示词
    const prompt = generateReviewPrompt(prDetails, settings);
    console.log('💭 Generated prompt:', {
      length: prompt.length,
      preview: prompt.substring(0, 200) + '...'
    });

    // 调用GPT API进行代码审查
    console.log('🤖 Starting code review...');
    const reviewResult = await callAIAPI(prompt, settings);

    // 返回审查结果
    console.log('✅ Review completed');
    return {
      success: true,
      data: {
        review: reviewResult,
        files: prDetails.changedFiles,
        summary: {
          totalFiles: prDetails.changed_files,
          additions: prDetails.additions,
          deletions: prDetails.deletions
        }
      }
    };

  } catch (error) {
    console.error('❌ PR analysis failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 提交GitHub Review评论
async function submitGitHubReview(prData, reviewContent) {
  const settings = await getSettings();
  const token = settings.githubToken;
  
  console.log('📝 Submitting GitHub review:', {
    owner: prData.owner,
    repo: prData.repo,
    prNumber: prData.prNumber
  });

  const endpoint = `/repos/${prData.owner}/${prData.repo}/pulls/${prData.prNumber}/reviews`;
  
  try {
    const response = await fetch(`https://api.github.com${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        body: reviewContent,
        event: 'COMMENT' // 可以是 'APPROVE', 'REQUEST_CHANGES', 或 'COMMENT'
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to submit review: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Review submitted successfully:', data);
    return data;
  } catch (error) {
    console.error('❌ Failed to submit review:', error);
    throw error;
  }
}

// 更新消息监听器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'GET_PR_DETAILS':
      getPRDetails(request.data)
        .then(sendResponse)
        .catch(error => {
          console.error('Failed to get PR details:', error);
          sendResponse({ error: error.message });
        });
      return true;

    case 'ANALYZE_PR':
      handlePRAnalysis(request.data)
        .then(sendResponse)
        .catch(error => {
          console.error('Failed to analyze PR:', error);
          sendResponse({ error: error.message });
        });
      return true;

    case 'GET_SETTINGS':
      getSettings().then(sendResponse);
      return true;

    case 'SUBMIT_REVIEW':
      submitGitHubReview(request.data.prInfo, request.data.review)
        .then(sendResponse)
        .catch(error => {
          console.error('Failed to submit review:', error);
          sendResponse({ error: error.message });
        });
      return true;
  }
});

async function getSettings() {
  return await chrome.storage.sync.get(null);
} 