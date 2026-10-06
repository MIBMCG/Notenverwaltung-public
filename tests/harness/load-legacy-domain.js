'use strict';
const { loadLegacyGrading } = require('./load-legacy-grading.js');

// Independent Wave-3.1 oracle: never load the production facade here.
function loadLegacyDomain(options) {
  const { DomainModel, GradingLogic, sandbox } = loadLegacyGrading(options);
  return { DomainModel, GradingLogic, sandbox };
}

module.exports = { loadLegacyDomain };
