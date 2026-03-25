/**
 * Workspace Manager 测试脚本
 *
 * 用法:
 *   npx tsx scripts/test-workspace.ts
 */

import { workspaceManager, type AgentType } from '@/lib/workspace'
import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message}\n  Expected: ${expected}\n  Actual: ${actual}`)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testCreateAndGet() {
  console.log('\n=== Test: Create and Get ===')

  // Clean up any existing test workspace
  const testId = 'test-workspace-' + Date.now()
  const existing = await workspaceManager.get(testId)
  if (existing) {
    await workspaceManager.delete(testId)
  }

  // Create workspace
  const workspace = await workspaceManager.create('test-account-001', testId)
  assertEqual(workspace.id, testId, 'workspace id should match')
  assertEqual(workspace.accountId, 'test-account-001', 'account id should match')
  assertEqual(workspace.status, 'running', 'status should be running')
  assertEqual(workspace.currentStep, null, 'currentStep should be null')
  assertEqual(workspace.checkpoint.completedSteps.length, 0, 'no completed steps')

  // Verify directory structure
  const workspacePath = workspace.path
  assert(fs.existsSync(path.join(workspacePath, '01-trend')), '01-trend dir should exist')
  assert(fs.existsSync(path.join(workspacePath, '02-topic')), '02-topic dir should exist')
  assert(fs.existsSync(path.join(workspacePath, '03-research')), '03-research dir should exist')
  assert(fs.existsSync(path.join(workspacePath, '04-write')), '04-write dir should exist')
  assert(fs.existsSync(path.join(workspacePath, '05-images')), '05-images dir should exist')
  assert(fs.existsSync(path.join(workspacePath, '06-review')), '06-review dir should exist')
  assert(fs.existsSync(path.join(workspacePath, '07-publish')), '07-publish dir should exist')
  assert(fs.existsSync(path.join(workspacePath, 'output')), 'output dir should exist')
  assert(fs.existsSync(path.join(workspacePath, 'run.json')), 'run.json should exist')

  // Get workspace
  const retrieved = await workspaceManager.get(testId)
  assert(retrieved !== null, 'retrieved workspace should not be null')
  assertEqual(retrieved!.id, testId, 'retrieved id should match')

  console.log('  [PASS] Create and Get')

  return testId
}

async function testWriteAndRead(workspaceId: string) {
  console.log('\n=== Test: Write and Read ===')

  // Write JSON output
  const jsonData = { items: [{ title: 'Test Item', score: 42 }], total: 1 }
  await workspaceManager.writeOutput(workspaceId, 'trend', 'items.json', JSON.stringify(jsonData, null, 2))

  // Read it back
  const readJson = await workspaceManager.readPreviousOutput(workspaceId, 'trend', 'items.json')
  assert(readJson !== null, 'read result should not be null')
  const parsed = readJson as { items: Array<{ title: string; score: number }>; total: number }
  assertEqual(parsed.items[0].title, 'Test Item', 'item title should match')
  assertEqual(parsed.items[0].score, 42, 'item score should match')

  // Write markdown output
  const markdown = '# Test Article\n\nThis is a test article body.'
  await workspaceManager.writeOutput(workspaceId, 'write', 'final.md', markdown)

  // Read markdown back
  const readMd = await workspaceManager.readPreviousOutput(workspaceId, 'write', 'final.md')
  assert(readMd !== null, 'read result should not be null')
  assertEqual(readMd, markdown, 'markdown should match')

  // Read non-existent file
  const nonExistent = await workspaceManager.readPreviousOutput(workspaceId, 'trend', 'nonexistent.json')
  assertEqual(nonExistent, null, 'non-existent file should return null')

  console.log('  [PASS] Write and Read')
}

async function testCheckpoint(workspaceId: string) {
  console.log('\n=== Test: Checkpoint ===')

  // Checkpoint trend step
  const trendOutput = { items: [{ title: 'Trend 1' }], itemCount: 1 }
  await workspaceManager.checkpoint(workspaceId, 'trend', trendOutput)

  // Verify run.json was updated
  const workspace = await workspaceManager.get(workspaceId)
  assertEqual(workspace!.checkpoint.completedSteps.length, 1, 'should have 1 completed step')
  assertEqual(workspace!.checkpoint.completedSteps[0], 'trend', 'completed step should be trend')
  assertEqual(workspace!.currentStep, 'topic', 'currentStep should advance to topic')

  // Checkpoint topic step
  const topicOutput = { topics: [{ id: 't1', title: 'Topic 1' }], topicCount: 1 }
  await workspaceManager.checkpoint(workspaceId, 'topic', topicOutput)

  const workspace2 = await workspaceManager.get(workspaceId)
  assertEqual(workspace2!.checkpoint.completedSteps.length, 2, 'should have 2 completed steps')
  assertEqual(workspace2!.checkpoint.completedSteps[1], 'topic', 'second completed step should be topic')
  assertEqual(workspace2!.currentStep, 'research', 'currentStep should advance to research')

  console.log('  [PASS] Checkpoint')
}

async function testResume(workspaceId: string) {
  console.log('\n=== Test: Resume ===')

  // Create a new workspace for resume test
  const resumeTestId = 'test-resume-' + Date.now()
  await workspaceManager.create('test-account-002', resumeTestId)

  // Checkpoint through several steps
  await workspaceManager.checkpoint(resumeTestId, 'trend', { items: ['item1'] })
  await workspaceManager.checkpoint(resumeTestId, 'topic', { topics: ['topic1'] })
  await workspaceManager.checkpoint(resumeTestId, 'research', { summary: 'research summary' })

  // Resume
  const resumeResult = await workspaceManager.resume(resumeTestId)
  assertEqual(resumeResult.currentStep, 'write', 'should resume at write step')
  // previousOutputs stores the actual objects (parsed from JSON in checkpoint)
  const trendOutput = resumeResult.previousOutputs['trend'] as { items: string[] } | null
  assert(trendOutput !== null && trendOutput.items[0] === 'item1', 'should have trend output')
  const topicOutput = resumeResult.previousOutputs['topic'] as { topics: string[] } | null
  assert(topicOutput !== null && topicOutput.topics[0] === 'topic1', 'should have topic output')
  const researchOutput = resumeResult.previousOutputs['research'] as { summary: string } | null
  assert(researchOutput !== null && researchOutput.summary === 'research summary', 'should have research output')

  // Cleanup
  await workspaceManager.delete(resumeTestId)

  console.log('  [PASS] Resume')
}

async function testList(workspaceId: string) {
  console.log('\n=== Test: List ===')

  const workspaces = await workspaceManager.list()
  const ids = workspaces.map((w) => w.id)

  assert(ids.includes(workspaceId), 'current test workspace should be in list')

  // Should have at least the workspace we created
  assert(workspaces.length >= 1, 'should have at least 1 workspace')

  console.log('  [PASS] List')
}

async function testSetStatus(workspaceId: string) {
  console.log('\n=== Test: Set Status ===')

  // Create a new workspace for status test
  const statusTestId = 'test-status-' + Date.now()
  await workspaceManager.create('test-account-003', statusTestId)

  // Mark as completed
  await workspaceManager.setStatus(statusTestId, 'completed')
  let workspace = await workspaceManager.get(statusTestId)
  assertEqual(workspace!.status, 'completed', 'status should be completed')

  // Create another for failed test
  const failedTestId = 'test-failed-' + Date.now()
  await workspaceManager.create('test-account-004', failedTestId)
  await workspaceManager.setStatus(failedTestId, 'failed')
  workspace = await workspaceManager.get(failedTestId)
  assertEqual(workspace!.status, 'failed', 'status should be failed')

  // Cleanup
  await workspaceManager.delete(statusTestId)
  await workspaceManager.delete(failedTestId)

  console.log('  [PASS] Set Status')
}

async function testDelete() {
  console.log('\n=== Test: Delete ===')

  const deleteTestId = 'test-delete-' + Date.now()
  await workspaceManager.create('test-account-005', deleteTestId)

  // Verify exists
  let workspace = await workspaceManager.get(deleteTestId)
  assert(workspace !== null, 'workspace should exist before delete')

  // Delete
  await workspaceManager.delete(deleteTestId)

  // Verify gone
  workspace = await workspaceManager.get(deleteTestId)
  assertEqual(workspace, null, 'workspace should be null after delete')

  console.log('  [PASS] Delete')
}

async function testGetNextStep() {
  console.log('\n=== Test: Get Next Step ===')

  assertEqual(workspaceManager.getNextStep('trend'), 'topic', 'next step after trend should be topic')
  assertEqual(workspaceManager.getNextStep('topic'), 'research', 'next step after topic should be research')
  assertEqual(workspaceManager.getNextStep('research'), 'write', 'next step after research should be write')
  assertEqual(workspaceManager.getNextStep('write'), 'images', 'next step after write should be images')
  assertEqual(workspaceManager.getNextStep('images'), 'review', 'next step after images should be review')
  assertEqual(workspaceManager.getNextStep('review'), 'publish', 'next step after review should be publish')
  assertEqual(workspaceManager.getNextStep('publish'), null, 'next step after publish should be null')

  console.log('  [PASS] Get Next Step')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60))
  console.log('Workspace Manager Test Suite')
  console.log('='.repeat(60))

  let workspaceId: string | null = null

  try {
    // Run tests
    workspaceId = await testCreateAndGet()
    await testWriteAndRead(workspaceId)
    await testCheckpoint(workspaceId)
    await testResume(workspaceId)
    await testList(workspaceId)
    await testSetStatus(workspaceId)
    await testDelete()
    await testGetNextStep()

    console.log('\n' + '='.repeat(60))
    console.log('All tests passed!')
    console.log('='.repeat(60))
  } catch (err) {
    console.error('\n[FAIL]', err instanceof Error ? err.message : String(err))
    if (err instanceof Error && err.stack) {
      console.error(err.stack)
    }
    process.exit(1)
  } finally {
    // Cleanup
    if (workspaceId) {
      try {
        await workspaceManager.delete(workspaceId)
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
