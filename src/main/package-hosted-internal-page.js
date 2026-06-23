const SWARM_PUBLISH_UNAVAILABLE = Object.freeze({
  code: 'SWARM_PUBLISH_UNAVAILABLE',
  message: 'Swarm publishing is shell-owned and unavailable in package mode',
});

const PAYMENTS_UNAVAILABLE = Object.freeze({
  code: 'PAYMENTS_UNAVAILABLE',
  message: 'Payment history is shell-owned and unavailable in package mode',
});

function isPackageHostedInternalPage(event) {
  const hostWebContents = event?.sender?.hostWebContents;
  if (!hostWebContents) {
    return false;
  }

  const { isPackageWebContents } = require('./shell-api');
  return isPackageWebContents(hostWebContents) === true;
}

function packageHostedSwarmPublishUnavailable() {
  return {
    success: false,
    error: { ...SWARM_PUBLISH_UNAVAILABLE },
  };
}

function packageHostedPaymentsUnavailable() {
  return {
    success: false,
    error: { ...PAYMENTS_UNAVAILABLE },
  };
}

module.exports = {
  PAYMENTS_UNAVAILABLE,
  SWARM_PUBLISH_UNAVAILABLE,
  isPackageHostedInternalPage,
  packageHostedPaymentsUnavailable,
  packageHostedSwarmPublishUnavailable,
};
