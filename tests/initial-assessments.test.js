'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadModules } = require('./harness/load.js');

test('shared initial-assessment helper creates M1 and S1 in their named categories', () => {
  const modules = loadModules();
  const { exports: assessments } = loadEsmGraph('src/domain/initial-assessments.js');
  const state = modules.DomainModel.createEmptyState();
  state.settings.categories = [
    { id: 'other', name: 'Sonstiges' },
    { id: 'written', name: 'Schriftlich' },
    { id: 'oral', name: 'Mündlich' }
  ];
  const course = modules.DomainModel.createCourse({ name: 'Biologie', subject: 'Biologie' });

  assessments.createInitialAssessmentsForCourse(modules.DomainModel, state, course, '2025-H2');

  assert.deepEqual(JSON.parse(JSON.stringify(state.assessments.map(assessment => ({
    courseId: assessment.courseId,
    categoryId: assessment.categoryId,
    title: assessment.title,
    weight: assessment.weight,
    term: assessment.term
  })))), [
    { courseId: course.id, categoryId: 'oral', title: 'M1', weight: 1, term: '2025-H2' },
    { courseId: course.id, categoryId: 'written', title: 'S1', weight: 1, term: '2025-H2' }
  ]);
});
