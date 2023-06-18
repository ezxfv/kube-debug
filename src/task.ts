import * as vscode from 'vscode';
import * as path from 'path';

import * as util from "./util";

export async function runMain(conf: any, workDir?: string): Promise<void> {
    process.chdir(conf.cwd || workDir);
    await util.execAsync(`${conf.buildCommand}`);
    const { stdout: containerName } = await util.execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
    await util.execAsync(`kubectl cp ${conf.binary} ${conf.namespace}/${conf.pod}:${conf.targetPath} -c ${containerName}`);
    await util.execAsync(`rm -rf ${conf.binary}`);
    await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- pkill -SIGUSR1 -f "python.*supervisor.py"`);

    vscode.window.showInformationMessage(`copied new binary to pod: ${conf.pod}`);
}

export async function runTest(conf: any, workDir?: string): Promise<void> {
    const symbolName = conf.testName;
    let debugBin = `_debug_bin_${symbolName}`;
    const relativeDir = conf.pkgPath;

    process.chdir(path.join(util.getWorkspaceDir(), relativeDir));

    await util.execAsync(`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go test -c -gcflags="all=-N -l" -o ${debugBin}`);
    const { stdout: containerName } = await util.execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
    const targetBin = path.join(conf.targetDir, relativeDir, debugBin);
    const targetDir = path.dirname(targetBin);
    const gotestFlags = (conf.testFlags || []).join(" ");

    await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- mkdir -p ${targetDir}`);
    await util.execAsync(`kubectl cp ${debugBin} ${conf.namespace}/${conf.pod}:${targetBin} -c ${containerName}`);
    await util.execAsync(`rm -rf ${debugBin}`);

    const envVars = {
        ENV_VAR_1: 'xxx yyy'
    };
    let envVarString = "";
    if (Object.keys(envVars || {}).length > 0) {
        envVarString = "export " + Object.entries(envVars)
            .map(([key, value]) => `${key}='${value}'`)
            .join(' ') + " && ";
    }

    await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- bash -c "${envVarString} cd ${targetDir} && ./${debugBin} ${gotestFlags} -test.run ${symbolName}"`, {}, "Kube-Debug: Run Test");
}