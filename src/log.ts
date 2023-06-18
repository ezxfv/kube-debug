import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';

import * as util from "./util";

export async function copyLogsToOutputChannels(taskCfg: any, logPrefix: string) {
    const spawnOptions = {
        env: {
            ...process.env,
            KUBECONFIG: taskCfg.kubeConfig,
        },
        shell: true,
    };
    const kubeConfigEnv = { "KUBECONFIG": taskCfg.kubeConfig };
    let containerName = taskCfg.container;
    if (!containerName) {
        const { stdout: firstContainerName } = await util.execAsync(`kubectl get pod ${taskCfg.pod} -n ${taskCfg.namespace} -o jsonpath="{.spec.containers[0].name}"`, kubeConfigEnv);
        containerName = firstContainerName;
    }

    const tailLogProcesses: child_process.ChildProcess[] = [];

    for (const logName of taskCfg.logs) {
        const logPath = path.join(taskCfg.targetDir, logName);
        const tailLogCmd = `kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- tail -n 50 ${logPath} -f`;

        console.log(`[${logName}] tail cmd: ${tailLogCmd}`);

        const outputChannelName = `${logPrefix}: ${taskCfg.targetDir}/${logName}`;
        const outputChannel = util.getOrCreateOutputChannel(outputChannelName);

        const tailLogProc = child_process.spawn(tailLogCmd, spawnOptions);

        tailLogProc.stdout.on('data', (data) => {
            outputChannel.append(data.toString());
        });

        tailLogProc.stderr.on('data', (data) => {
            outputChannel.append(data.toString());
        });

        tailLogProc.on('exit', (code, signal) => {
            if (code !== 0) {
                outputChannel.append(`Tail Log Exited with ${code || signal}`);
            }
        });

        tailLogProcesses.push(tailLogProc);
    }

    // Return a closure that will kill all tailLogProcesses
    return async () => {
        console.log("killing tail processes");
        for (const proc of tailLogProcesses) {
            proc.kill('SIGINT');
        }
        try{
            await util.execAsync(`kubectl exec ${taskCfg.pod} -n ${taskCfg.namespace} -c ${containerName} -- pkill tail`, kubeConfigEnv);
        } catch (error) {
            console.error("Error during pkill tail:", error);
        }
        console.log("killed all tail processes");
    };
}