const SWARM_PUBLISH_UNAVAILABLE = Object.freeze({
  code: 'SWARM_PUBLISH_UNAVAILABLE',
  message: 'Swarm publishing is shell-owned and unavailable in package mode',
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

module.exports = {
  SWARM_PUBLISH_UNAVAILABLE,
  isPackageHostedInternalPage,
  packageHostedSwarmPublishUnavailable,
};
