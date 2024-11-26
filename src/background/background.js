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
    model: 'claude-3-5-sonnet-latest'
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
- 语言：{language}
- 历史review信息: {reviews}

请根据上述信息和历史评论记录进行全面的代码审查，重点关注：
1. 之前评论中提到的问题是否已经解决
2. 是否有新的问题需要关注
3. 代码改进的建议`,
    maxTokens: 1000,
    ignoreFiles: []
  }
};

// 存储popup窗口的引用
let popupWindow = null;

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
    dataPreview: data
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
    // 并行获取PR信息、文件变更和评论信息
    const [prData, files, reviews, reviewComments, issueComments] = await Promise.all([
      // 获取PR基本信息
      githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, token),
      // 获取PR文件变更
      githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/files`, token),
      // 获取PR reviews
      githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, token),
      // 获取review comments
      githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/comments`, token),
      // 获取issue comments
      githubRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, token)
    ]);

    console.log('📝 获取到的PR评论数据:', {
      reviews: reviews.length,
      reviewComments: reviewComments.length,
      issueComments: issueComments.length
    });

    // 格式化评论信息
    const formattedReviews = formatReviewsAndComments(reviews, reviewComments, issueComments);

    console.log('✨ 格式化后的评论信息:', {
      formattedReviewsLength: formattedReviews.length,
      preview: formattedReviews.substring(0, 2000) + '...'
    });

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
      changed_files: prData.changed_files,
      reviews: formattedReviews
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

// 格式化评论和review信息
function formatReviewsAndComments(reviews = [], reviewComments = [], issueComments = []) {
  const allFeedback = [
    ...reviews.map(review => ({
      type: 'review_decision',
      author: review.user.login,
      state: review.state,
      content: review.body || '',
      submitted_at: review.submitted_at
    })),
    ...reviewComments.map(comment => ({
      type: 'review_comment',
      author: comment.user.login,
      content: comment.body,
      file: comment.path,
      line: comment.line,
      submitted_at: comment.created_at
    })),
    ...issueComments.map(comment => ({
      type: 'issue_comment',
      author: comment.user.login,
      content: comment.body,
      submitted_at: comment.created_at
    }))
  ];

  // 按时间排序
  allFeedback.sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));

  if (allFeedback.length === 0) {
    return '暂无评论和审查记录';
  }

  return allFeedback.map(feedback => {
    switch (feedback.type) {
      case 'review_decision':
        const stateMap = {
          APPROVED: '批准了PR',
          CHANGES_REQUESTED: '请求修改',
          COMMENTED: '评论了PR',
          DISMISSED: '驳回了review'
        };
        const action = stateMap[feedback.state] || feedback.state;
        return `${feedback.author} ${action}${feedback.content ? `:\n${feedback.content}` : ''}`;
      
      case 'review_comment':
        return `${feedback.author} 在文件 ${feedback.file} 第 ${feedback.line} 行评论:\n${feedback.content}`;
      
      case 'issue_comment':
        return `${feedback.author} 评论:\n${feedback.content}`;
    }
  }).join('\n\n');
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

  // 输出完整提示词
  console.log('📝 Full Prompt:', {
    content: prompt,
    length: prompt.length
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
        temperature: 0.7,
        stream: true
      };
      break;

    case 'anthropic':
      apiKey = settings.anthropicSettings.apiKey;
      endpoint = 'https://api.anthropic.com/v1/messages';
      model = settings.anthropicSettings.model;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
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
        system: '你是一个专业的代码审查员，请用中文回复。',
        stream: true
      };
      break;
  }

  console.log('📤 AI API Request:', {
    service: service,
    endpoint: endpoint,
    model: model,
    maxTokens: settings.reviewSettings.maxTokens,
    headers: Object.keys(headers), // 只记录header keys，不记录敏感值
    body: {
      ...body,
      messages: body.messages.map(msg => ({
        role: msg.role,
        contentLength: msg.content.length
      }))
    }
  });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ AI API Error Response:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      throw new Error(`AI API error: ${response.status} - ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    let chunkCount = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      buffer += chunk;
      chunkCount++;
      
      console.log(`📥 Received chunk #${chunkCount}:`, {
        chunkSize: chunk.length,
        bufferSize: buffer.length,
        chunk: chunk
      });
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim() === '') continue;
        if (line.trim() === 'data: [DONE]') continue;
        
        try {
          if (service === 'openai') {
            if (!line.startsWith('data: ')) continue;
            const jsonString = line.replace(/^data: /, '').trim();
            if (!jsonString) continue;
            
            const json = JSON.parse(jsonString);
            console.log('📝 OpenAI Stream Data:', {
              deltaLength: json.choices[0]?.delta?.content?.length || 0,
              totalLength: fullContent.length,
              contentJson: json
            });
            
            const content = json.choices[0]?.delta?.content || '';
            if (content) {
              fullContent += content;
              chrome.runtime.sendMessage({
                type: 'STREAM_UPDATE',
                data: {
                  content: content,
                  done: false
                }
              });
            }
            
          } else if (service === 'anthropic') {
            if (line.startsWith('event: ')) continue;
            if (!line.startsWith('data: ')) continue;
            
            const jsonString = line.replace(/^data: /, '').trim();
            if (!jsonString) continue;
            
            const json = JSON.parse(jsonString);
            console.log('📝 Anthropic Stream Data:', {
              type: json.type,
              deltaLength: json.delta?.text?.length || 0,
              totalLength: fullContent.length
            });
            
            if (json.type === 'content_block_delta') {
              const content = json.delta?.text || '';
              if (content) {
                fullContent += content;
                chrome.runtime.sendMessage({
                  type: 'STREAM_UPDATE',
                  data: {
                    content: content,
                    done: false
                  }
                });
              }
            }
          }
        } catch (e) {
          console.warn('⚠️ Failed to parse streaming response line:', {
            line: line,
            error: e.message
          });
          continue;
        }
      }
    }

    console.log('✅ AI Response Completed:', {
      totalLength: fullContent.length,
      chunkCount: chunkCount,
      service: service,
      model: model
    });

    // 发送完成消息
    chrome.runtime.sendMessage({
      type: 'STREAM_UPDATE',
      data: {
        content: '',
        done: true
      }
    });

    return {
      content: fullContent,
      tokenUsage: {
        total: Math.round(fullContent.length / 4) // 简单估算token数
      }
    };
  } catch (error) {
    console.error('❌ AI API Error:', {
      error: error.message,
      service: service,
      endpoint: endpoint
    });
    throw error;
  }
}

// 生成审查提示词
function generateReviewPrompt(prDetails, settings) {
  console.log('🎯 Generating review prompt...');
  
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

  // 格式化评论历史
  const reviewHistory = prDetails.reviews ? 
    `\n\n=== 历史评论记录 ===\n${prDetails.reviews}` : '';

  const prompt = settings.reviewSettings.reviewPrompt
    .replace('{files}', filesList)
    .replace('{diff}', diffs)
    .replace('{language}', Array.from(languages).join(', '))
    .replace('{reviews}', reviewHistory);

  console.log('📋 Generated Prompt Details:', {
    filesCount: prDetails.changedFiles.length,
    diffLength: diffs.length,
    languages: Array.from(languages),
    reviewsLength: reviewHistory.length,
    totalLength: prompt.length
  });

  return prompt;
}

// PR分析处理
async function handlePRAnalysis(prData) {
  console.log('🔍 Starting PR Analysis:', {
    ...prData,
    timestamp: new Date().toISOString()
  });
  
  // 获取基础设置
  const settings = await getSettings();
  
  // 合并临时设置（如果有）
  const finalSettings = {
    ...settings,
    aiService: prData.tempSettings?.aiService || settings.aiService,
    reviewSettings: {
      ...settings.reviewSettings,
      reviewPrompt: prData.tempSettings?.reviewPrompt || settings.reviewSettings.reviewPrompt
    }
  };
  
  console.log('📝 Using AI Service:', {
    service: finalSettings.aiService,
    model: finalSettings.aiService === 'openai' 
      ? finalSettings.openaiSettings?.model || DEFAULT_SETTINGS.openaiSettings.model
      : finalSettings.anthropicSettings?.model
  });
  
  // 修改配置检查逻辑
  if (!finalSettings.githubToken) {
    throw new Error('GitHub Token未配置');
  }

  // 根据选择的服务检查对应的API Key
  if (finalSettings.aiService === 'openai' && !finalSettings.openaiSettings?.apiKey) {
    throw new Error('OpenAI API Key未置');
  } else if (finalSettings.aiService === 'anthropic' && !finalSettings.anthropicSettings?.apiKey) {
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
    const ignorePatterns = finalSettings.reviewSettings.ignoreFiles;
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
    const prompt = generateReviewPrompt(prDetails, finalSettings);
    console.log('💭 Generated prompt:', {
      length: prompt.length,
      preview: prompt.substring(0, 200) + '...'
    });

    // 调用GPT API进行代码审查
    console.log('🤖 Starting code review...');
    const { content: reviewResult, tokenUsage } = await callAIAPI(prompt, finalSettings);

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
        },
        tokenUsage
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
  if (request.type === 'OPEN_POPUP') {
    console.log('Opening popup window...');
    // 如果已经有打开的窗口，就focus它
    if (popupWindow) {
      chrome.windows.update(popupWindow.id, { focused: true });
    } else {
      // 创建新的popup窗口
      chrome.windows.create({
        url: chrome.runtime.getURL('src/popup/popup.html'),
        type: 'popup',
        width: 400,
        height: 600,
        left: sender.tab ? Math.round(sender.tab.width - 420) : undefined,
        top: sender.tab ? Math.round(sender.tab.height * 0.1) : undefined
      }, (window) => {
        popupWindow = window;
        // 监听窗口关闭
        chrome.windows.onRemoved.addListener(function onRemoved(windowId) {
          if (windowId === popupWindow.id) {
            popupWindow = null;
            chrome.windows.onRemoved.removeListener(onRemoved);
          }
        });
      });
    }
    return true;
  }
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

    case 'openPopup':
      chrome.action.openPopup();
      return true;
  }
});

async function getSettings() {
  return await chrome.storage.sync.get(null);
} 