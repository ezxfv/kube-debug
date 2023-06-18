import * as child_process from 'child_process';

const spawnOptions = {
    env: {
        ...process.env,
    },
    shell: true,
};

//const tailLogCmd = `kubectl exec myapp-1 -- tail -n 10 /app/main-1.log -f`;
const tailLogCmd = `kubectl exec myapp-1 -- /bin/bash -c "tail -n 10 /app/main-1.log -f & PID=$!; trap 'kill $PID' INT TERM; wait $PID"`;

console.log("tail cmd:", tailLogCmd);

const tailLogProc = child_process.spawn(tailLogCmd, spawnOptions);

tailLogProc.stdout.on('data', (data) => {
    console.log(data.toString());
});

tailLogProc.stderr.on('data', (data) => {
    console.log(data.toString());
});

tailLogProc.on('exit', (code, signal) => {
    if (code !== 0) {
        console.log(`Tail Log Exited with ${code || signal}`);
    }
});

setTimeout(()=>{
    tailLogProc.kill();
    console.log(`proc killed: ${tailLogProc.exitCode}`);
}, 3000);
