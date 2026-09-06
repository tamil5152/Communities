import { NextRequest, NextResponse } from 'next/server';

interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

interface CustomPushSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

interface SubscriptionData {
  subscription: CustomPushSubscription;
  userAgent?: string;
  timestamp?: string;
}

interface SubscriptionPayload {
  endpoint: string;
  keys: PushSubscriptionKeys;
  userAgent: string;
  timestamp: string;
  subscriptionId: string;
}

/**
 * Saves a push notification subscription by dispatching to GitHub Actions
 */
export async function POST(request: NextRequest) {
  // Disable in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.json(
      { error: 'Push notifications are disabled in non-production environments' },
      { status: 403 }
    );
  }

  try {
    const data: SubscriptionData = await request.json();

    if (!data.subscription) {
      return NextResponse.json({ error: 'Subscription data is required' }, { status: 400 });
    }

    // Validate subscription object
    if (!data.subscription.endpoint || !data.subscription.keys) {
      return NextResponse.json({ error: 'Invalid subscription format' }, { status: 400 });
    }

    // Prepare data for GitHub Actions dispatch
    const subscriptionId = await generateSubscriptionId(data.subscription.endpoint);
    const subscriptionPayload = {
      endpoint: data.subscription.endpoint,
      keys: {
        p256dh: data.subscription.keys.p256dh,
        auth: data.subscription.keys.auth
      },
      userAgent: data.userAgent || 'Unknown',
      timestamp: data.timestamp || new Date().toISOString(),
      subscriptionId
    };

    // Dispatch to GitHub Actions
    const githubResponse = await dispatchToGitHub(subscriptionPayload);

    if (!githubResponse.ok) {
      const errorDetail = await githubResponse.text();
      console.error('GitHub dispatch failed:', {
        status: githubResponse.status,
        statusText: githubResponse.statusText,
        repository: getGithubRepository(),
        detail: errorDetail
      });

      return NextResponse.json(
        {
          error: 'GitHub dispatch failed',
          githubStatus: githubResponse.status
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Subscription saved successfully',
        subscriptionId: subscriptionPayload.subscriptionId
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error saving subscription:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getGithubRepository() {
  return process.env.GITHUB_REPOSITORY || 'FOSSUChennai/Communities';
}

/**
 * Dispatches subscription data to GitHub Actions workflow
 */
async function dispatchToGitHub(subscriptionData: SubscriptionPayload) {
  // GH_PAT is supported for deployments that use the same naming convention
  // as the GitHub Actions workflows; GITHUB_TOKEN remains the preferred name.
  const githubToken = process.env.GITHUB_TOKEN || process.env.GH_PAT;
  const githubRepo = getGithubRepository();

  if (!githubToken) {
    throw new Error('GitHub token not configured');
  }

  const [owner, repo] = githubRepo.split('/');

  if (!owner || !repo || githubRepo.split('/').length !== 2) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: ${githubRepo}`);
  }

  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

  return fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'TamilNadu-Tech-Notifications/1.0',
      'X-GitHub-Api-Version': '2026-03-10'
    },
    body: JSON.stringify({
      event_type: 'save_push_subscription',
      client_payload: {
        subscription: subscriptionData,
        action: 'save'
      }
    })
  });
}

/**
 * Generates a unique subscription ID from endpoint
 */
async function generateSubscriptionId(endpoint: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(endpoint);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
