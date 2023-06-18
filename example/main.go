package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

func handler(w http.ResponseWriter, r *http.Request) {
	uri := r.URL.Path

	fmt.Fprintf(w, "[kube-debug] 访问的URI是：%s", uri)
}

func main() {
	logFiles := []string{
		"main-1.log",
		"main-2.log",
		"main-3.log",
	}
	for _, lf := range logFiles {
		go func(file string) {
			os.Remove(file)
			f, err := os.Create(file)
			if err != nil {
				panic(err)
			}
			for i := 0; i < 10000; i++ {
				f.WriteString(fmt.Sprintf("%s: %d\n", file, i))
				time.Sleep(time.Second)
			}
			f.Close()
		}(lf)
	}

	http.HandleFunc("/", handler)

	log.Fatal(http.ListenAndServe(":8080", nil))
}
