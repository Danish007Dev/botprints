import { redis } from '@devvit/web/server';

export type MetricKeys = 
  | 'accounts_actioned' 
  | 'items_filtered' 
  | 'bans_issued' 
  | 'rings_detected' 
  | 'appeals_sent' 
  | 'appeals_responded';

// Increment a global metric and a daily metric
export async function incrementMetric(key: MetricKeys, amount = 1): Promise<void> {
  const globalKey = `bp:metrics:global`;
  const dateStr = new Date().toISOString().split('T')[0];
  const dailyKey = `bp:metrics:daily:${dateStr}`;

  try {
    // We increment both global counts and daily rollups
    await redis.hIncrBy(globalKey, key, amount);
    await redis.hIncrBy(dailyKey, key, amount);
  } catch (e) {
    console.warn(`Failed to increment metric ${key}:`, e);
  }
}

// Get metrics for dashboard
export async function getDashboardMetrics() {
  const globalKey = `bp:metrics:global`;
  const globalData = await redis.hGetAll(globalKey);

  const metrics = {
    accounts_actioned: parseInt(globalData.accounts_actioned || '0', 10),
    items_filtered: parseInt(globalData.items_filtered || '0', 10),
    bans_issued: parseInt(globalData.bans_issued || '0', 10),
    rings_detected: parseInt(globalData.rings_detected || '0', 10),
    appeals_sent: parseInt(globalData.appeals_sent || '0', 10),
    appeals_responded: parseInt(globalData.appeals_responded || '0', 10),
  };

  // Get daily history for sparkline (last 14 days)
  const dailyActivity = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dailyKey = `bp:metrics:daily:${dateStr}`;
    try {
      const dailyData = await redis.hGetAll(dailyKey);
      // We track accounts flagged/actioned per day for the sparkline chart
      dailyActivity.push({
        date: dateStr,
        count: parseInt(dailyData.accounts_actioned || '0', 10)
      });
    } catch {
      dailyActivity.push({ date: dateStr, count: 0 });
    }
  }

  // Calculate estimated hours saved
  // Formula: (accounts_actioned * 15m) + (rings_detected * 45m)
  const minutesSaved = (metrics.accounts_actioned * 15) + (metrics.rings_detected * 45);
  const hoursSaved = (minutesSaved / 60).toFixed(1);

  return {
    ...metrics,
    hoursSaved,
    dailyActivity
  };
}
