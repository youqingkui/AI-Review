// GitHub API 相关操作
class GitHubAPI {
  constructor(token) {
    this.token = token;
  }

  // 通过background script发送GitHub API请求
  async sendRequest(endpoint, method = 'GET') {
    return await chrome.runtime.sendMessage({
      type: 'GITHUB_API_REQUEST',
      endpoint,
      method
    });
  }

  // 获取PR详情
  async getPRDetails(owner, repo, prNumber) {
    try {
      const [prData, files] = await Promise.all([
        this.sendRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`),
        this.sendRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/files`)
      ]);

      return {
        title: prData.title,
        description: prData.body || '',
        author: prData.user.login,
        base: prData.base.ref,
        head: prData.head.ref,
        changedFiles: files.map(file => ({
          name: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch
        })),
        commits: prData.commits,
        additions: prData.additions,
        deletions: prData.deletions,
        changed_files: prData.changed_files
      };
    } catch (error) {
      console.error('Failed to get PR details:', error);
      throw error;
    }
  }

  // 获取PR的reviews
  async getPRReviews(owner, repo, prNumber) {
    return await this.sendRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`);
  }

  // 获取PR的review comments
  async getPRReviewComments(owner, repo, prNumber) {
    return await this.sendRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/comments`);
  }

  // 获取PR的issue comments
  async getPRIssueComments(owner, repo, prNumber) {
    return await this.sendRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`);
  }

  // 格式化评论和review信息
  formatReviewsAndComments(reviews = [], reviewComments = [], issueComments = []) {
    console.log('🔄 开始格式化评论信息');
    
    const allFeedback = [
      // Review 决定（批准/请求修改等）
      ...reviews.map(review => {
        // 只保留有内容的review决定
        if (review.state !== 'COMMENTED' || (review.body && review.body.trim())) {
          const item = {
            type: 'review_decision',
            author: review.user.login,
            state: review.state,
            content: review.body?.trim() || '',
            submitted_at: review.submitted_at
          };
          console.log('👤 Review决定:', item);
          return item;
        }
        return null;
      }).filter(Boolean), // 过滤掉null

      // Review 中的具体评论
      ...reviewComments.map(comment => {
        // 只保留有内容的评论
        if (comment.body && comment.body.trim()) {
          const item = {
            type: 'review_comment',
            author: comment.user.login,
            content: comment.body.trim(),
            file: comment.path,
            line: comment.line || comment.position,
            submitted_at: comment.created_at
          };
          console.log('💬 Review评论:', item);
          return item;
        }
        return null;
      }).filter(Boolean),

      // PR下的一般评论
      ...issueComments.map(comment => {
        // 只保留有内容的评论
        if (comment.body && comment.body.trim()) {
          const item = {
            type: 'issue_comment',
            author: comment.user.login,
            content: comment.body.trim(),
            submitted_at: comment.created_at
          };
          console.log('📝 Issue评论:', item);
          return item;
        }
        return null;
      }).filter(Boolean)
    ];

    // 按时间排序
    allFeedback.sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));

    if (allFeedback.length === 0) {
      console.log('⚠️ 没有找到任何评论和审查记录');
      return '暂无评论和审查记录';
    }

    const formattedResult = allFeedback.map(feedback => {
      let result;
      switch (feedback.type) {
        case 'review_decision':
          const stateMap = {
            APPROVED: '批准了PR',
            CHANGES_REQUESTED: '请求修改',
            COMMENTED: '评论了PR',
            DISMISSED: '驳回了review'
          };
          const action = stateMap[feedback.state] || feedback.state;
          // 只有当有内容时才添加内容部分
          result = `${feedback.author} ${action}${feedback.content ? `:\n${feedback.content}` : ''}`;
          break;
        
        case 'review_comment':
          if (feedback.line) {
            result = `${feedback.author} 在文件 ${feedback.file} 第 ${feedback.line} 行评论:\n${feedback.content}`;
          } else {
            result = `${feedback.author} 在文件 ${feedback.file} 评论:\n${feedback.content}`;
          }
          break;
        
        case 'issue_comment':
          result = `${feedback.author} 评论:\n${feedback.content}`;
          break;
      }
      console.log('📎 格式化的评论:', { type: feedback.type, result });
      return result;
    }).join('\n\n');

    console.log('✅ 评论格式化完成:', { 
      totalComments: allFeedback.length,
      formattedLength: formattedResult.length,
      preview: formattedResult.substring(0, 200) + '...'
    });

    return formattedResult;
  }

  // 获取完整PR信息（包括评论和reviews）
  async getAllPRInfo(owner, repo, prNumber) {
    try {
      console.log('🔍 开始获取PR完整信息:', { owner, repo, prNumber });
      
      // 并行获取所有需要的信息
      const [prDetails, reviews, reviewComments, issueComments] = await Promise.all([
        this.getPRDetails(owner, repo, prNumber),
        this.getPRReviews(owner, repo, prNumber),
        this.getPRReviewComments(owner, repo, prNumber),
        this.getPRIssueComments(owner, repo, prNumber)
      ]);

      // 打印获取到的原始数据
      console.log('📝 获取到的PR评论数据:', {
        reviews: reviews.length ? reviews : '无reviews',
        reviewComments: reviewComments.length ? reviewComments : '无review comments',
        issueComments: issueComments.length ? issueComments : '无issue comments'
      });

      // 格式化评论信息
      const formattedReviews = this.formatReviewsAndComments(reviews, reviewComments, issueComments);
      console.log('✨ 格式化后的评论信息:', {
        reviewsCount: reviews.length,
        reviewCommentsCount: reviewComments.length,
        issueCommentsCount: issueComments.length,
        formattedContent: formattedReviews
      });

      const result = {
        ...prDetails,
        reviews: formattedReviews
      };

      // 打印最终结果
      console.log('✅ 完整PR信息:', {
        title: result.title,
        description: result.description?.substring(0, 100) + '...',
        changedFiles: result.changedFiles?.length,
        reviewsLength: result.reviews?.length,
        reviews: result.reviews
      });

      return result;
    } catch (error) {
      console.error('❌ 获取PR信息失败:', error);
      throw error;
    }
  }
}

// 将类暴露到window对象
window.GitHubAPI = GitHubAPI; 