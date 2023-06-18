import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';

import * as util from "./util";
import * as log from "./log";

const contextMap = new Map<string, {debugType: string, taskCfg: any, portForwardProc: child_process.ChildProcess, tailLogProc?: child_process.ChildProcess}>();
const sessionDataMap = new Map<string, { logCallback: any, portForwardProc: any, tailLogProc: any }>();

export const disposableStartDebug = vscode.debug.onDidStartDebugSession(async (session) => {
    const ctxData = contextMap.get(session.name);
    if (ctxData) {
        var logCallback;
        if (ctxData.debugType === "main") {
            logCallback = await log.copyLogsToOutputChannels(ctxData.taskCfg, "Kube Debug Main Log:");
        } else {
            logCallback = await log.copyLogsToOutputChannels(ctxData.taskCfg, "Kube Debug Test Log:");
        }
        sessionDataMap.set(session.name, {logCallback: logCallback, portForwardProc: ctxData.portForwardProc, tailLogProc: ctxData.tailLogProc});
    }
});

export const disposableTerminateDebug = vscode.debug.onDidTerminateDebugSession(async (session) => {
    const sessionData = sessionDataMap.get(session.name);
    if (sessionData) {
        if (sessionData.portForwardProc) {
            sessionData.portForwardProc.kill();
            console.log(`portForwardProc process killed, exitCode: $sessionData.portForwardProc.exitCode}`);
        }
        if (sessionData.tailLogProc) {
            sessionData.tailLogProc.kill();
            console.log(`tailLogProc process killed, exitCode: ${sessionData.tailLogProc.exitCode}`);
        }
        if (sessionData.logCallback) {
            await sessionData.logCallback();
        }
    }
});

export async function runMain(taskCfg: any, workDir?: string): Promise<void> {
    const goEnv = util.envStr(taskCfg.goEnv || {});
    const kubeConfigEnv = {"KUBECONFIG": taskCfg.kubeConfig};
    const targetBin = path.join(taskCfg.targetDir, taskCfg.binary);

    process.chdir(taskCfg.cwd || workDir);

    await util.execAsync(`${goEnv} ${taskCfg.command} ${taskCfg.toolArgs.join(" ")} -o ${taskCfg.binary}`);
    let containerName = taskCfg.container;
    if (!containerName) {
        const { stdout: firstContainerName } = await util.execAsync(`kubectl get pod ${taskCfg.pod} -n ${taskCfg.namespace} -o jsonpath="{.spec.containers[0].name}"`, kubeConfigEnv);
        containerName = firstContainerName;
    }
    await util.execAsync(`kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- mkdir -p ${taskCfg.targetDir}`, kubeConfigEnv);
    await util.execAsync(`kubectl cp ${taskCfg.binary} ${taskCfg.namespace}/${taskCfg.pod}:${targetBin} -c ${containerName}`, kubeConfigEnv);
    await util.execAsync(`rm -rf ${taskCfg.binary}`);
    await util.execAsync(`kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- pkill -SIGUSR1 -f "python.*supervisor.py"`, kubeConfigEnv);

    vscode.window.showInformationMessage(`copied new binary to pod: ${taskCfg.pod}`);
}

export async function debugMain(taskCfg: any, workDir?: string): Promise<void> {
    const kubeConfigEnv = {"KUBECONFIG": taskCfg.kubeConfig};
    const spawnOptions = {
        env: {
          ...process.env,
          KUBECONFIG: taskCfg.kubeConfig,
        },
        shell: true,
    };

    let portForwardCmd = `kubectl port-forward -n ${taskCfg.namespace || "default"} pods/${taskCfg.pod} 2345:2345`;
    let portForwardProc = child_process.spawn(portForwardCmd, spawnOptions);
    await util.sleep(1000);

    let containerName = taskCfg.container;
    if (!containerName) {
        const { stdout: firstContainerName } = await util.execAsync(`kubectl get pod ${taskCfg.pod} -n ${taskCfg.namespace} -o jsonpath="{.spec.containers[0].name}"`, kubeConfigEnv);
        containerName = firstContainerName;
    }

    const logPath = path.join(taskCfg.targetDir, "debug.log");
    let tailLogCmd = `kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- tail -n 50 ${logPath} -f`;
    let outputChannelName = "Kube-Debug: Tail Log";
    let outputChannel = util.getOrCreateOutputChannel(outputChannelName);

    let tailLogProc = child_process.spawn(tailLogCmd, spawnOptions);

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
    contextMap.set(debugTaskName, {debugType: "main", taskCfg: taskCfg, portForwardProc: portForwardProc, tailLogProc: tailLogProc});

    vscode.debug.startDebugging(undefined, {
        type: 'go',
        request: 'attach',
        name: debugTaskName,
        mode: "remote",
        remotePath: workDir,
        host: "127.0.0.1",
        port: 2345
    });
}

export async function runTest(taskCfg: any, workDir?: string): Promise<void> {
    const goEnv = util.envStr(taskCfg.goEnv || {});
    const kubeConfigEnv = {"KUBECONFIG": taskCfg.kubeConfig};

    const symbolName = taskCfg.testName;
    let debugBin = `_debug_bin_${symbolName}`;

    process.chdir(path.join(util.getWorkspaceDir(), taskCfg.pkgDir));

    let containerName = taskCfg.container;
    if (!containerName) {
        const { stdout: firstContainerName } = await util.execAsync(`kubectl get pod ${taskCfg.pod} -n ${taskCfg.namespace} -o jsonpath="{.spec.containers[0].name}"`, kubeConfigEnv);
        containerName = firstContainerName;
    }

    await util.execAsync(`${goEnv} ${taskCfg.command} ${taskCfg.toolArgs.join(" ")} -o ${debugBin}`);
    const targetBin = path.join(taskCfg.targetDir, debugBin);
    const targetDir = path.dirname(targetBin);
    const gotestArgs = (taskCfg.args || []).join(" ");

    await util.execAsync(`kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- mkdir -p ${targetDir}`, kubeConfigEnv);
    await util.execAsync(`kubectl cp ${debugBin} ${taskCfg.namespace}/${taskCfg.pod}:${targetBin} -c ${containerName}`, kubeConfigEnv);
    await util.execAsync(`rm -rf ${debugBin}`);

    let envVarString = "";
    if (Object.keys(taskCfg.env || {}).length > 0) {
        envVarString = "export " + Object.entries(taskCfg.env)
            .map(([key, value]) => `${key}='${value}'`)
            .join(' ') + " && ";
    }

    await util.execAsync(`kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- bash -c "${envVarString} cd ${targetDir} && ./${debugBin} ${gotestArgs} -test.run ${symbolName}"`, kubeConfigEnv, "Kube-Debug: Run Test");
}

export async function debugTest(taskCfg: any, workDir?: string): Promise<void> {
    const goEnv = util.envStr(taskCfg.goEnv || {});
    const kubeConfigEnv = {"KUBECONFIG": taskCfg.kubeConfig};
    const spawnOptions = {
        env: {
          ...process.env,
          KUBECONFIG: taskCfg.kubeConfig,
        },
        shell: true,
    };

    const symbolName = taskCfg.testName;
    const debugBin = taskCfg.binary;
    process.chdir(path.join(util.getWorkspaceDir(), taskCfg.pkgDir));

    await util.execAsync(`${goEnv} ${taskCfg.command} -gcflags="all=-N -l" -o ${debugBin}`);
    let containerName = taskCfg.container;
    if (!containerName) {
        const { stdout: firstContainerName } = await util.execAsync(`kubectl get pod ${taskCfg.pod} -n ${taskCfg.namespace} -o jsonpath="{.spec.containers[0].name}"`, kubeConfigEnv);
        containerName = firstContainerName;
    }
    const targetBin = path.join(taskCfg.targetDir, debugBin);
    const targetDir = path.dirname(targetBin);
    const gotestArgs = (taskCfg.args || []).join(" ");

    await util.execAsync(`kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- mkdir -p ${targetDir}`, kubeConfigEnv);
    await util.execAsync(`kubectl cp ${debugBin} ${taskCfg.namespace}/${taskCfg.pod}:${targetBin} -c ${containerName}`, kubeConfigEnv);
    await util.execAsync(`rm -rf ${debugBin}`);

    const procEnv = util.envStr(taskCfg.env);

    let dlvCmd = `kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- bash -c "${procEnv} cd ${targetDir} && dlv exec --headless --listen=:2346 --api-version=2 -- ${targetBin} ${gotestArgs} -test.run ${symbolName}"`;
    console.log(dlvCmd);

    let outputChannelName = "Kube-Debug: Debug Test";
    let outputChannel = util.getOrCreateOutputChannel(outputChannelName);

    let dlvProc = child_process.spawn(dlvCmd, spawnOptions);
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
    
    let portForwardCmd = `kubectl port-forward -n ${taskCfg.namespace || "default"} pods/${taskCfg.pod} 2346:2346`;
    let portForwardProc = child_process.spawn(portForwardCmd, spawnOptions);
    await util.sleep(1000);


    let debugTaskName = `Debug Test ${symbolName} in Kube Pod ${taskCfg.namespace || "default"}/${taskCfg.pod}`;

    contextMap.set(debugTaskName, {debugType: "main", taskCfg: taskCfg, portForwardProc: portForwardProc});

    vscode.debug.startDebugging(undefined, {
        type: 'go',
        request: 'attach',
        name: debugTaskName,
        mode: "remote",
        remotePath: util.getWorkspaceDir(),
        host: "127.0.0.1",
        port: 2346
    });
}