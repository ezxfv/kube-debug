import os
import sys
import signal
import subprocess
import time
import threading
import logging
from logging.handlers import RotatingFileHandler


class Supervisor:
    def __init__(self, cmd):
        self.cmd = cmd
        self.proc = None
         # Set up rotating log handler
        self.handler = RotatingFileHandler('debug.log', maxBytes=10*1024*1024, backupCount=5)
        self.logger = logging.getLogger('MyLogger')
        self.logger.addHandler(self.handler)
        self.logger.setLevel(logging.INFO)

    def handle_output(self, pipe, dst):
        for line in iter(pipe.readline, b''):
            line = line.decode().rstrip()
            print(line, file=dst)  # print to stdout or stderr
            self.logger.info(line)  # log to file
            
    def start_process(self):
        self.proc = subprocess.Popen(self.cmd, shell=True, preexec_fn=os.setsid,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE)
         # Start threads to handle the process's output and errors
        threading.Thread(target=self.handle_output, args=(self.proc.stdout, sys.stdout)).start()
        threading.Thread(target=self.handle_output, args=(self.proc.stderr, sys.stderr)).start()
        
    def kill_process(self):
        if self.proc:
            print('Killing process with pid %d' % self.proc.pid)
            os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            print('Process killed')
            self.proc.wait()
            self.proc = None

    def reload(self, signum, frame):
        print("Reloading...")
        self.kill_process()
        self.start_process()

    def term(self, signum, frame):
        if self.proc:
            self.kill_process()
        exit(0)
    
def main():
    cmd = 'dlv --headless --continue --accept-multiclient --listen=:2345 --api-version=2 exec /app/myapp'
    supervisor = Supervisor(cmd)

    # Register SIGUSR1 handler
    signal.signal(signal.SIGUSR1, supervisor.reload)
    signal.signal(signal.SIGTERM, supervisor.term)

    while True:
        if supervisor.proc is None:
            supervisor.start_process()
        else:
            exit_code = supervisor.proc.poll()
            if exit_code is not None:  # The process is not running
                print('Process exited with code %d' % exit_code)
                supervisor.proc.wait()  # Clean up the process
                supervisor.proc = None
        time.sleep(1)

if __name__ == '__main__':
    main()