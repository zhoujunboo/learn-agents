import { spawn } from "node:child_process";

// const command = "ls -la";

//  模拟用户输入两个 n（回答交互提示）
const command =
  'echo -e "n\nn" | pnpm create vite react-todo-app --template react-ts';

// 在哪个目录执行（当前工作目录）
const cwd = process.cwd();

// 解析命令和参数
const [cmd, ...args] = command.split(" ");

// 启动一个子进程，在当前目录下用 shell 执行 ls -la，并把结果实时输出到控制台。
const child = spawn(cmd, args, {
  cwd,
  stdio: "inherit", // 实时输出到控制台
  shell: true,
});

let errorMsg = "";

child.on("error", (error) => {
  errorMsg = error.message;
});

// 	子进程退出时触发 ,退出码为 0 → 成功，父进程也正常退出   || 退出码非 0 → 出错了
//  子进程跑成功了父进程也正常退出，子进程报错了就把错误信息打出来并以失败状态退出。
child.on("close", (code) => {
  // 用子进程的退出码退出父进程
  if (code === 0) {
    process.exit(0);
  }
  // 如果子进程没给退出码就默认 1
  else {
    if (errorMsg) {
      console.error(`错误: ${errorMsg}`);
    }
    process.exit(code || 1);
  }
});
