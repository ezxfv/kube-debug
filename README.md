# kube-debug README

"Kube-debug" is a VS Code extension that simplifies the process of debugging applications running in Kubernetes. It provides the `attachToPodCmd` command, which executes `kubectl port-forward` to map the port of a specified Kubernetes pod to a local port, and then starts a remote debugging session.

## Features

This extension provides a command that executes the following steps:

1. Use `kubectl port-forward` to map the port of a specified Kubernetes pod to a local port.
2. Start a remote debugging session.
3. When the debugging session ends, it kills the `kubectl` child process.


## Requirements

You need to have `kubectl` installed and configured to use this extension.

## Extension Settings

This extension contributes the following settings:

* `kube-debug.namespace`: Specify the Kubernetes namespace. Default is "default".
* `kube-debug.pod`: Specify the name of the Kubernetes pod.

## Known Issues

Please report any issues you find on the GitHub issue tracker.

## Release Notes

### 0.0.1

Initial release of kube-debug.

---

## For more information

* [Visual Studio Code's Extension Development Documentation](https://code.visualstudio.com/api)

**Enjoy!**