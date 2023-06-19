import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';

import * as util from "./util";

export async function runMain(taskCfg: any, workDir?: string): Promise<void> {
    const goEnv = util.envStr(taskCfg.goEnv || {});

    process.chdir(taskCfg.cwd || workDir);
    await util.execAsync(`${goEnv} ${taskCfg.buildCommand}`);
    const { stdout: containerName } = await util.execAsync(`kubectl get pod ${taskCfg.pod} -n ${taskCfg.namespace} -o jsonpath="{.spec.containers[0].name}"`);
    await util.execAsync(`kubectl cp ${taskCfg.binary} ${taskCfg.namespace}/${taskCfg.pod}:${taskCfg.targetPath} -c ${containerName}`);
    await util.execAsync(`rm -rf ${taskCfg.binary}`);
    await util.execAsync(`kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- pkill -SIGUSR1 -f "python.*supervisor.py"`);

    vscode.window.showInformationMessage(`copied new binary to pod: ${taskCfg.pod}`);
}

export async function debugMain(taskCfg: any, workDir?: string): Promise<void> {
    let portForwardProc = child_process.spawn('kubectl', ['port-forward', '-n', `${taskCfg.namespace || "default"}`, `pods/${taskCfg.pod}`, '2345:2345']);
    await util.sleep(1000);

    const { stdout: containerName } = await util.execAsync(`kubectl get pod ${taskCfg.pod} -n ${taskCfg.namespace} -o jsonpath="{.spec.containers[0].name}"`);

    const logPath = path.join(path.dirname(taskCfg.targetPath), "debug.log");
    let command = `kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- tail -n 50 ${logPath} -f`;
    let outputChannelName = "Kube-Debug: Tail Log";
    let outputChannel = util.getOrCreateOutputChannel(outputChannelName);

    let tailLogProc = child_process.spawn(command, { shell: true });

    tailLogProc.stdout.on('data', (data) => {
        outputChannel.append(data.toString());
    });

    tailLogProc.stderr.on('data', (data) => {
        outputChannel.append(data.toString());
    });

    tailLogProc.on('exit', (code, signal) => {
        if (code !== 0) {
            outputChannel.append(`Exited with ${code || signal}`);
        }
    });

    let debugTaskName = `Attach to Kube Pod ${taskCfg.namespace || "default"}/${taskCfg.pod}`;
    vscode.debug.startDebugging(undefined, {
        type: 'go',
        request: 'attach',
        name: debugTaskName,
        mode: "remote",
        remotePath: workDir,
        host: "127.0.0.1",
        port: 2345
    });

    vscode.debug.onDidTerminateDebugSession((session) => {
        if (session.name === debugTaskName) {
            // 调试会话结束时，kill子进程
            portForwardProc.kill();
            tailLogProc.kill();
            console.log(`portForwardProc process killed, exitCode: ${portForwardProc.exitCode}`);
            console.log(`tailLogProc process killed, exitCode: ${tailLogProc.exitCode}`);
        }
    });
}

export async function runTest(taskCfg: any, workDir?: string): Promise<void> {
    const symbolName = taskCfg.testName;
    let debugBin = `_debug_bin_${symbolName}`;
    const relativeDir = taskCfg.pkgPath;
    const goEnv = util.envStr(taskCfg.goEnv || {});

    process.chdir(path.join(util.getWorkspaceDir(), relativeDir));

    await util.execAsync(`${goEnv} go test -c -gcflags="all=-N -l" -o ${debugBin}`);
    const { stdout: containerName } = await util.execAsync(`kubectl get pod ${taskCfg.pod} -n ${taskCfg.namespace} -o jsonpath="{.spec.containers[0].name}"`);
    const targetBin = path.join(taskCfg.targetDir, relativeDir, debugBin);
    const targetDir = path.dirname(targetBin);
    const gotestArgs = (taskCfg.args || []).join(" ");

    await util.execAsync(`kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- mkdir -p ${targetDir}`);
    await util.execAsync(`kubectl cp ${debugBin} ${taskCfg.namespace}/${taskCfg.pod}:${targetBin} -c ${containerName}`);
    await util.execAsync(`rm -rf ${debugBin}`);

    let envVarString = "";
    if (Object.keys(taskCfg.env || {}).length > 0) {
        envVarString = "export " + Object.entries(taskCfg.env)
            .map(([key, value]) => `${key}='${value}'`)
            .join(' ') + " && ";
    }

    await util.execAsync(`kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- bash -c "${envVarString} cd ${targetDir} && ./${debugBin} ${gotestArgs} -test.run ${symbolName}"`, {}, "Kube-Debug: Run Test");
}

export async function debugTest(taskCfg: any, workDir?: string): Promise<void> {
    const symbolName = taskCfg.testName;
    let debugBin = `_debug_bin_${symbolName}`;
    const relativeDir = taskCfg.pkgPath;
    const goEnv = util.envStr(taskCfg.goEnv || {});
    const localDir = path.join(util.getWorkspaceDir(), relativeDir);

    process.chdir(localDir);

    await util.execAsync(`${goEnv} go test -c -gcflags="all=-N -l" -o ${debugBin}`);
    const { stdout: containerName } = await util.execAsync(`kubectl get pod ${taskCfg.pod} -n ${taskCfg.namespace} -o jsonpath="{.spec.containers[0].name}"`);
    const targetBin = path.join(taskCfg.targetDir, relativeDir, debugBin);
    const targetDir = path.dirname(targetBin);
    const gotestArgs = (taskCfg.args || []).join(" ");

    await util.execAsync(`kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- mkdir -p ${targetDir}`);
    await util.execAsync(`kubectl cp ${debugBin} ${taskCfg.namespace}/${taskCfg.pod}:${targetBin} -c ${containerName}`);
    await util.execAsync(`rm -rf ${debugBin}`);

    const procEnv = util.envStr(taskCfg.env);

    let command = `kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- bash -c "${procEnv} cd ${targetDir} && dlv exec --headless --listen=:2346 --api-version=2 -- ${targetBin} ${gotestArgs} -test.run ${symbolName}"`;
    console.log(localDir, workDir, targetDir, util.getWorkspaceDir());
    console.log(command);

    let outputChannelName = "Kube-Debug: Debug Test";
    let outputChannel = util.getOrCreateOutputChannel(outputChannelName);

    let dlvProc = child_process.spawn(command, { shell: true });
    dlvProc.stdout.on('data', (data) => {
        outputChannel.append(data.toString());
    });
    dlvProc.stderr.on('data', (data) => {
        outputChannel.append(data.toString());
    });
    dlvProc.on('exit', (code, signal) => {
        if (code !== 0) {
            outputChannel.append(`Exited with ${code || signal}`);
        }
    });

    let portForwardProc = child_process.spawn('kubectl', ['port-forward', '-n', `${taskCfg.namespace || "default"}`, `pods/${taskCfg.pod}`, '2346:2346']);
    await util.sleep(1000);

    let debugTaskName = `Debug Test ${symbolName} in Kube Pod ${taskCfg.namespace || "default"}/${taskCfg.pod}`;
    vscode.debug.startDebugging(undefined, {
        type: 'go',
        request: 'attach',
        name: debugTaskName,
        mode: "remote",
        remotePath: util.getWorkspaceDir(),
        host: "127.0.0.1",
        port: 2346
    });

    vscode.debug.onDidTerminateDebugSession((session) => {
        if (session.name === debugTaskName) {
            // 调试会话结束时，kill子进程
            portForwardProc.kill();
            dlvProc.kill();
            console.log(`port forward process killed, exitCode: ${portForwardProc.exitCode}`);
            console.log(`dlv process killed, exitCode: ${dlvProc.exitCode}`);
        }
    });
}