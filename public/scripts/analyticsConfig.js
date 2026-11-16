// Production collection stays off until App Check and deployment have been verified.
export const analyticsConfig = Object.freeze({
    collectionEnabled: false,
    appCheckSiteKey: '',
    endpoint: '/api/events',
    maxBatchEvents: 40,
    maxQueuedBatches: 20,
    maxBatchBytes: 48000,
    maxAttempts: 8
});
