import { spawn } from 'child_process';

console.log('⚡ Kallisti\'s Micro-Scalper - RAPID MODE (15s intervals)');

async function runBot() {
  while (true) {
    try {
      const process = spawn('bun', ['src/agent.ts'], {
        cwd: '/home/workspace/Kallisti_Scalper',
        stdio: 'inherit'
      });

      await new Promise((resolve, reject) => {
        process.on('close', (code) => {
          if (code === 0) {
            resolve(code);
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });
      });
    } catch (error) {
      console.error('Bot run failed:', error);
    }

    // Wait 15 seconds before next run
    console.log('⏳ Next scan in 15s...');
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
}

runBot();
