import { useState, useEffect, useRef } from 'react'
import './App.css'

interface Todo {
  id: number
  text: string
  completed: boolean
  createdAt: number
}

type FilterType = 'all' | 'active' | 'completed'

function App() {
  const [todos, setTodos] = useState<Todo[]>(() => {
    const saved = localStorage.getItem('todos')
    return saved ? JSON.parse(saved) : []
  })
  const [inputValue, setInputValue] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [removingIds, setRemovingIds] = useState<Set<number>>(new Set())
  const [addingId, setAddingId] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // 持久化到 localStorage
  useEffect(() => {
    localStorage.setItem('todos', JSON.stringify(todos))
  }, [todos])

  // 编辑时自动聚焦
  useEffect(() => {
    if (editingId !== null && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingId])

  // 添加 Todo
  const addTodo = () => {
    const text = inputValue.trim()
    if (!text) return

    const newId = Date.now()
    const newTodo: Todo = {
      id: newId,
      text,
      completed: false,
      createdAt: Date.now(),
    }

    setAddingId(newId)
    setTodos(prev => [newTodo, ...prev])
    setInputValue('')
    inputRef.current?.focus()

    setTimeout(() => setAddingId(null), 400)
  }

  // 删除 Todo（带动画）
  const deleteTodo = (id: number) => {
    setRemovingIds(prev => new Set(prev).add(id))
    setTimeout(() => {
      setTodos(prev => prev.filter(todo => todo.id !== id))
      setRemovingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 350)
  }

  // 切换完成状态
  const toggleTodo = (id: number) => {
    setTodos(prev =>
      prev.map(todo =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    )
  }

  // 开始编辑
  const startEditing = (todo: Todo) => {
    setEditingId(todo.id)
    setEditingText(todo.text)
  }

  // 保存编辑
  const saveEditing = () => {
    if (editingId === null) return
    const text = editingText.trim()
    if (!text) {
      deleteTodo(editingId)
    } else {
      setTodos(prev =>
        prev.map(todo =>
          todo.id === editingId ? { ...todo, text } : todo
        )
      )
    }
    setEditingId(null)
    setEditingText('')
  }

  // 取消编辑
  const cancelEditing = () => {
    setEditingId(null)
    setEditingText('')
  }

  // 清除已完成
  const clearCompleted = () => {
    const completedIds = todos.filter(t => t.completed).map(t => t.id)
    setRemovingIds(new Set(completedIds))
    setTimeout(() => {
      setTodos(prev => prev.filter(todo => !todo.completed))
      setRemovingIds(new Set())
    }, 350)
  }

  // 筛选
  const filteredTodos = todos.filter(todo => {
    if (filter === 'active') return !todo.completed
    if (filter === 'completed') return todo.completed
    return true
  })

  // 统计
  const totalCount = todos.length
  const activeCount = todos.filter(t => !t.completed).length
  const completedCount = todos.filter(t => t.completed).length

  // 键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') addTodo()
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEditing()
    if (e.key === 'Escape') cancelEditing()
  }

  return (
    <div className="app">
      <div className="app-container">
        {/* 头部 */}
        <header className="header">
          <h1 className="title">
            <span className="title-icon">✅</span>
            Todo List
          </h1>
          <p className="subtitle">高效管理你的每一天</p>
        </header>

        {/* 输入区域 */}
        <div className="input-section">
          <input
            ref={inputRef}
            type="text"
            className="todo-input"
            placeholder="添加新任务..."
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="add-btn" onClick={addTodo} disabled={!inputValue.trim()}>
            <span className="btn-icon">+</span>
            添加
          </button>
        </div>

        {/* 统计信息 */}
        <div className="stats-bar">
          <div className="stat-item">
            <span className="stat-number total">{totalCount}</span>
            <span className="stat-label">全部</span>
          </div>
          <div className="stat-item">
            <span className="stat-number active">{activeCount}</span>
            <span className="stat-label">进行中</span>
          </div>
          <div className="stat-item">
            <span className="stat-number completed">{completedCount}</span>
            <span className="stat-label">已完成</span>
          </div>
          {totalCount > 0 && (
            <div className="progress-wrapper">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
                />
              </div>
              <span className="progress-text">
                {totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%
              </span>
            </div>
          )}
        </div>

        {/* 筛选标签 */}
        <div className="filter-bar">
          <div className="filter-tabs">
            {(['all', 'active', 'completed'] as FilterType[]).map(f => (
              <button
                key={f}
                className={`filter-tab ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? '📋 全部' : f === 'active' ? '⏳ 进行中' : '✅ 已完成'}
              </button>
            ))}
          </div>
          {completedCount > 0 && (
            <button className="clear-btn" onClick={clearCompleted}>
              🗑️ 清除已完成
            </button>
          )}
        </div>

        {/* Todo 列表 */}
        <div className="todo-list">
          {filteredTodos.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">
                {filter === 'all' ? '📝' : filter === 'active' ? '🎉' : '📭'}
              </div>
              <p className="empty-text">
                {filter === 'all'
                  ? '还没有任务，添加一个吧！'
                  : filter === 'active'
                  ? '所有任务都完成了！'
                  : '还没有已完成的任务'}
              </p>
            </div>
          )}

          {filteredTodos.map(todo => (
            <div
              key={todo.id}
              className={`todo-item ${todo.completed ? 'completed' : ''} ${
                removingIds.has(todo.id) ? 'removing' : ''
              } ${addingId === todo.id ? 'adding' : ''}`}
            >
              {/* 复选框 */}
              <button
                className={`checkbox ${todo.completed ? 'checked' : ''}`}
                onClick={() => toggleTodo(todo.id)}
              >
                {todo.completed && <span className="check-icon">✓</span>}
              </button>

              {/* 内容 */}
              {editingId === todo.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  className="edit-input"
                  value={editingText}
                  onChange={e => setEditingText(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  onBlur={saveEditing}
                />
              ) : (
                <span
                  className="todo-text"
                  onDoubleClick={() => startEditing(todo)}
                  title="双击编辑"
                >
                  {todo.text}
                </span>
              )}

              {/* 操作按钮 */}
              <div className="todo-actions">
                {editingId !== todo.id && (
                  <>
                    <button
                      className="action-btn edit-btn"
                      onClick={() => startEditing(todo)}
                      title="编辑"
                    >
                      ✏️
                    </button>
                    <button
                      className="action-btn delete-btn"
                      onClick={() => deleteTodo(todo.id)}
                      title="删除"
                    >
                      🗑️
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 底部提示 */}
        <footer className="footer">
          <p>💡 双击任务可编辑 · 数据自动保存到本地</p>
        </footer>
      </div>
    </div>
  )
}

export default App
