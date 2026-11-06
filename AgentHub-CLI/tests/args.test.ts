import assert from 'node:assert/strict'
import test from 'node:test'
import { parseArgs, UsageError } from '../src/cli/args.ts'

test('defaults are an interactive run', () => {
  const args = parseArgs([])
  assert.equal(args.command, 'run')
  assert.equal(args.task, '')
  assert.equal(args.print, false)
  assert.equal(args.json, false)
  assert.equal(args.permission, undefined)
  assert.deepEqual(args.rest, [])
})

test('--json implies non-interactive and keeps positionals as one task', () => {
  const args = parseArgs(['--json', 'fix', 'the', 'tests'])
  assert.equal(args.json, true)
  assert.equal(args.print, true)
  assert.equal(args.task, 'fix the tests')
})

test('skills subcommands and flags parse', () => {
  const args = parseArgs([
    'skills',
    'install',
    './my-skill',
    '--force',
    '--user',
    '--skill',
    'demo',
    '--ref',
    'main',
    '--dir',
    'skills/demo',
  ])
  assert.equal(args.command, 'skills')
  assert.equal(args.subcommand, 'install')
  assert.deepEqual(args.rest, ['./my-skill'])
  assert.equal(args.force, true)
  assert.equal(args.user, true)
  assert.equal(args.skill, 'demo')
  assert.equal(args.ref, 'main')
  assert.equal(args.dir, 'skills/demo')
})

test('numeric options are validated', () => {
  const args = parseArgs([
    '--permission',
    'read-only',
    '--max-steps',
    '20',
    '--timeout',
    '5',
    '--app-url',
    'http://127.0.0.1:3000',
  ])
  assert.equal(args.permission, 'read-only')
  assert.equal(args.maxSteps, 20)
  assert.equal(args.timeoutMs, 5000)
  assert.equal(args.appUrl, 'http://127.0.0.1:3000')
  assert.throws(() => parseArgs(['--max-steps', '0']), UsageError)
  assert.throws(() => parseArgs(['--timeout', 'not-a-number']), UsageError)
})

test('--workspace and --model accept values that start with a dash', () => {
  const args = parseArgs(['--workspace', '--weird-dir'])
  assert.equal(args.workspace, '--weird-dir')
})

test('unknown options are usage errors', () => {
  assert.throws(() => parseArgs(['--definitely-not-a-flag']), /Unknown option/)
})

test('-- stops option parsing', () => {
  const args = parseArgs(['--', '--print', 'file.txt'])
  assert.equal(args.print, false)
  assert.equal(args.task, '--print file.txt')
})

test('resume accepts last', () => {
  const args = parseArgs(['--resume', 'last'])
  assert.equal(args.resume, 'last')
})

test('global flags may precede the command', () => {
  const doctor = parseArgs(['--json', 'doctor'])
  assert.equal(doctor.command, 'doctor')
  assert.equal(doctor.json, true)
  assert.equal(doctor.task, '')

  const skills = parseArgs(['--no-color', 'skills', 'list'])
  assert.equal(skills.command, 'skills')
  assert.equal(skills.subcommand, 'list')
})

