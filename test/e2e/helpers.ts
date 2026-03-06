import { spawn } from 'node:child_process'

export function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', d => { stdout += String(d) })
    child.stderr.on('data', d => { stderr += String(d) })

    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 0, stdout, stderr }))
  })
}