package demo

import (
	"os"
	"testing"
	"time"
)

func TestYYY(t *testing.T) {
	envNames := []string{
		"debug-env",
		"ENV_VAR_1",
		"cluster-id",
	}
	for _, envName := range envNames {
		env := os.Getenv(envName)
		t.Logf("%s: [%s]", envName, env)
	}

	for i := 0; i < 3; i++ {
		t.Logf("i: %d", i)
	}
}

func TestMultiLog(t *testing.T) {
	// logFiles := []string{
	// 	"test-1.log",
	// 	"test-2.log",
	// 	"test-3.log",
	// }
	// for _, lf := range logFiles {
	// 	go func(file string) {
	// 		os.Remove(file)
	// 		f, err := os.Create(file)
	// 		if err != nil {
	// 			panic(err)
	// 		}
	// 		for i := 0; i < 10000; i++ {
	// 			f.WriteString(fmt.Sprintf("%s: %d\n", file, i))
	// 			time.Sleep(time.Second)
	// 		}
	// 		f.Close()
	// 	}(lf)
	// }
	t.Log("printing log")
	time.Sleep(time.Second * 15)
	t.Log("print done")
}
