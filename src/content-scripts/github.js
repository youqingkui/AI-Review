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
    const allFeedback = [
      // Review 决定（批准/请求修改等）
      ...reviews.map(review => ({
        type: 'review_decision',
        author: review.user.login,
        state: review.state,
        content: review.body || '',
        submitted_at: review.submitted_at
      })),
      // Review 中的具体评论
      ...reviewComments.map(comment => ({
        type: 'review_comment',
        author: comment.user.login,
        content: comment.body,
        file: comment.path,
        line: comment.line,
        submitted_at: comment.created_at
      })),
      // PR下的一般评论
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

  // 获取完整PR信息（包括评论和reviews）
  async getAllPRInfo(owner, repo, prNumber) {
    try {
      // 并行获取所有需要的信息
      const [prDetails, reviews, reviewComments, issueComments] = await Promise.all([
        this.getPRDetails(owner, repo, prNumber),
        this.getPRReviews(owner, repo, prNumber),
        this.getPRReviewComments(owner, repo, prNumber),
        this.getPRIssueComments(owner, repo, prNumber)
      ]);

      // 添加格式化后的评论信息
      return {
        ...prDetails,
        reviews: this.formatReviewsAndComments(reviews, reviewComments, issueComments)
      };
    } catch (error) {
      console.error('Failed to get complete PR info:', error);
      throw error;
    }
  }
}

// 将类暴露到window对象
window.GitHubAPI = GitHubAPI; 