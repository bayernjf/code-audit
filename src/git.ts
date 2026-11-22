import { execFile } from 'node:child_process';
import type { GitInfo } from './types.js';

function git(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export async function readGitInfo(repoPath: string): Promise<GitInfo | undefined> {
  try {
    const commit = (await git(repoPath, ['rev-parse', 'HEAD'])).trim();
    const branch = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const status = (await git(repoPath, ['status', '--porcelain'])).trim();
    return {
      ...(commit ? { commit } : {}),
      ...(branch && branch !== 'HEAD' ? { branch } : {}),
      dirty: status.length > 0,
    };
  } catch {
    return undefined;
  }
}
