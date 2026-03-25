/**
 * Notification service for pipeline alerts.
 * Supports Slack webhooks and console logging (for development).
 */

export interface NotificationPayload {
  title: string
  message: string
  severity: 'info' | 'warning' | 'error'
  metadata?: Record<string, string | number | boolean>
}

/**
 * Send a notification to configured channels.
 * Currently supports Slack webhook (if configured) and console logging.
 */
export async function sendNotification(payload: NotificationPayload): Promise<void> {
  const { title, message, severity, metadata } = payload

  // Always log to console
  const logMethod = severity === 'error' ? console.error : severity === 'warning' ? console.warn : console.log
  logMethod(`[NOTIFICATION] [${severity.toUpperCase()}] ${title}: ${message}`)
  if (metadata) {
    logMethod(`[NOTIFICATION] Metadata:`, metadata)
  }

  // Send to Slack if configured
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL
  if (slackWebhookUrl) {
    try {
      await sendSlackNotification(slackWebhookUrl, payload)
    } catch (err) {
      console.error(`[NOTIFICATION] Failed to send Slack notification: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/**
 * Send a Slack webhook notification.
 */
async function sendSlackNotification(webhookUrl: string, payload: NotificationPayload): Promise<void> {
  const { title, message, severity, metadata } = payload

  const colorMap: Record<string, string> = {
    info: '#36a64f',
    warning: '#ff9800',
    error: '#f44336',
  }

  const body = {
    attachments: [
      {
        color: colorMap[severity] || colorMap.info,
        title,
        text: message,
        fields: metadata
          ? Object.entries(metadata).map(([k, v]) => ({
              title: k,
              value: String(v),
              short: true,
            }))
          : undefined,
        footer: 'Content Center',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Slack API returned ${response.status}: ${response.statusText}`)
  }
}

/**
 * Send a TaskRun failure notification.
 */
export async function notifyTaskRunFailure(
  taskRunId: string,
  taskType: string,
  accountId: string,
  error: string,
): Promise<void> {
  await sendNotification({
    title: `TaskRun Failed: ${taskType}`,
    message: error,
    severity: 'error',
    metadata: {
      taskRunId,
      taskType,
      accountId,
    },
  })
}

/**
 * Send a pipeline completion notification.
 */
export async function notifyPipelineComplete(
  workspaceId: string,
  topicCount: number,
  successCount: number,
  failedCount: number,
): Promise<void> {
  const severity = failedCount === topicCount ? 'error' : failedCount > 0 ? 'warning' : 'info'

  await sendNotification({
    title: `Pipeline ${failedCount === 0 ? 'Completed' : 'Finished with Failures'}`,
    message: `Processed ${topicCount} topics: ${successCount} succeeded, ${failedCount} failed`,
    severity,
    metadata: {
      workspaceId,
      topicCount,
      successCount,
      failedCount,
    },
  })
}
