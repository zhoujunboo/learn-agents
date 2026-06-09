import { useEffect, useMemo, useState } from 'react'
import './App.css'

type FilterType = 'all' | 'active' | 'completed'

type Todo = {
  id: string
  text: string
  completed: boolean
  editing?: boolean
}

const STORAGE_KEY = 'react-todo-list-v1'

function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [input, setInput] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [editValue, setEditValue] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) setTodos(JSON.parse(saved))
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }, [todos])

  const stats = useMemo(() => {
    const completed = todos.filter(t => t.completed).length
    const active = todos.length - completed
    return { total: todos.length, active, completed }
  }, [todos])

  const filteredTodos = useMemo(() => {
    if (filter === 'active') return todos.filter(t => !t.completed)
    if (filter === 'completed') return todos.filter(t => t.completed)
    return todos
  }, [todos, filter])

  const addTodo = () => {
    const text = input.trim()
    if (!text) return
    setTodos([{ id: crypto.randomUUID(), text, completed: false }, ...todos])
    setInput('')
  }

  const removeTodo = (id: string) => setTodos(todos.filter(t => t.id !== id))
  const toggleTodo = (id: string) =>
    setTodos(todos.map(t => (t.id === id ? { ...t, completed: !t.completed } : t)))

  const startEdit = (todo: Todo) => {
    setEditValue(todo.text)
    setTodos(todos.map(t => ({ ...t, editing: t.id === todo.id })))
  }

  const saveEdit = (id: string) => {
    const text = editValue.trim()
    if (!text) return
    setTodos(todos.map(t => (t.id === id ? { ...t, text, editing: false } : { ...t, editing: false })))
  }

  return (
    <div className="app-shell">
      <div className="todo-card">
        <h1>TodoList</h1>
        <p className="subtitle">功能完整的 React 待办事项应用</p>

        <div className="input-row">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTodo()}
            placeholder="添加新的待办事项..."
          />
          <button onClick={addTodo}>添加</button>
        </div>

        <div className="filters">
          {(['all', 'active', 'completed'] as FilterType[]).map(item => (
            <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
              {item === 'all' ? '全部' : item === 'active' ? '进行中' : '已完成'}
            </button>
          ))}
        </div>

        <div className="stats">
          <span>总计：{stats.total}</span>
          <span>进行中：{stats.active}</span>
          <span>已完成：{stats.completed}</span>
        </div>

        <ul className="todo-list">
          {filteredTodos.map(todo => (
            <li key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''} ${todo.editing ? 'editing' : ''}`}>
              <label className="todo-main">
                <input type="checkbox" checked={todo.completed} onChange={() => toggleTodo(todo.id)} />
                {todo.editing ? (
                  <input value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveEdit(todo.id)} />
                ) : (
                  <span>{todo.text}</span>
                )}
              </label>
              <div className="actions">
                {todo.editing ? (
                  <button onClick={() => saveEdit(todo.id)}>保存</button>
                ) : (
                  <button onClick={() => startEdit(todo)}>编辑</button>
                )}
                <button onClick={() => removeTodo(todo.id)}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default App
