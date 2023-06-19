import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';

import * as util from "./util";

export async function runMain(conf: any, workDir?: string): Promise<void> {
    const goEnv = util.envStr(conf.goEnv || {});

    process.chdir(conf.cwd || workDir);
    await util.execAsync(`${goEnv} ${conf.buildCommand}`);
    const { stdout: containerName } = await util.execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
    await util.execAsync(`kubectl cp ${conf.binary} ${conf.namespace}/${conf.pod}:${conf.targetPath} -c ${containerName}`);
    await util.execAsync(`rm -rf ${conf.binary}`);
    await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- pkill -SIGUSR1 -f "python.*supervisor.py"`);

    vscode.window.showInformationMessage(`copied new binary to pod: ${conf.pod}`);
}

export async function debugMain(conf: any, workDir?: string): Promise<void> {
    let portForwardProc = child_process.spawn('kubectl', ['port-forward', '-n', `${conf.namespace || "default"}`, `pods/${conf.pod}`, '2345:2345']);
    await util.sleep(1000);

    const { stdout: containerName } = await util.execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);

    const logPath = path.join(path.dirname(conf.targetPath), "debug.log");
    let command = `kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- tail -n 50 ${logPath} -f`;
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

    let debugTaskName = `Attach to Kube Pod ${conf.namespace || "default"}/${conf.pod}`;
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

export async function runTest(conf: any, workDir?: string): Promise<void> {
    const symbolName = conf.testName;
    let debugBin = `_debug_bin_${symbolName}`;
    const relativeDir = conf.pkgPath;
    const goEnv = util.envStr(conf.goEnv || {});

    process.chdir(path.join(util.getWorkspaceDir(), relativeDir));

    await util.execAsync(`${goEnv} go test -c -gcflags="all=-N -l" -o ${debugBin}`);
    const { stdout: containerName } = await util.execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
    const targetBin = path.join(conf.targetDir, relativeDir, debugBin);
    const targetDir = path.dirname(targetBin);
    const gotestArgs = (conf.args || []).join(" ");

    await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- mkdir -p ${targetDir}`);
    await util.execAsync(`kubectl cp ${debugBin} ${conf.namespace}/${conf.pod}:${targetBin} -c ${containerName}`);
    await util.execAsync(`rm -rf ${debugBin}`);

    let envVarString = "";
    if (Object.keys(conf.env || {}).length > 0) {
        envVarString = "export " + Object.entries(conf.env)
            .map(([key, value]) => `${key}='${value}'`)
            .join(' ') + " && ";
    }

    await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- bash -c "${envVarString} cd ${targetDir} && ./${debugBin} ${gotestArgs} -test.run ${symbolName}"`, {}, "Kube-Debug: Run Test");
}

export async function debugTest(conf: any, workDir?: string): Promise<void> {
    const symbolName = conf.testName;
    let debugBin = `_debug_bin_${symbolName}`;
    const relativeDir = conf.pkgPath;
    const goEnv = util.envStr(conf.goEnv || {});
    const localDir = path.join(util.getWorkspaceDir(), relativeDir);

    process.chdir(localDir);

    await util.execAsync(`${goEnv} go test -c -gcflags="all=-N -l" -o ${debugBin}`);
    const { stdout: containerName } = await util.execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
    const targetBin = path.join(conf.targetDir, relativeDir, debugBin);
    const targetDir = path.dirname(targetBin);
    const gotestArgs = (conf.args || []).join(" ");

    await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- mkdir -p ${targetDir}`);
    await util.execAsync(`kubectl cp ${debugBin} ${conf.namespace}/${conf.pod}:${targetBin} -c ${containerName}`);
    await util.execAsync(`rm -rf ${debugBin}`);

    const procEnv = util.envStr(conf.env);

    let command = `kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- bash -c "${procEnv} cd ${targetDir} && dlv exec --headless --listen=:2346 --api-version=2 -- ${targetBin} ${gotestArgs} -test.run ${symbolName}"`;
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

    let portForwardProc = child_process.spawn('kubectl', ['port-forward', '-n', `${conf.namespace || "default"}`, `pods/${conf.pod}`, '2346:2346']);
    await util.sleep(1000);

    let debugTaskName = `Debug Test ${symbolName} in Kube Pod ${conf.namespace || "default"}/${conf.pod}`;
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