'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createClass,
  deleteClass,
  fetchAdminMe,
  fetchClasses,
  fetchManagedAdmins,
  transferUserClass,
  updateClass
} from '../../../lib/api.js';

export default function ClassesPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [expandedClassIds, setExpandedClassIds] = useState(new Set());
  const [status, setStatus] = useState('loading');
  const [form, setForm] = useState({ name: '', teacherId: '' });
  const [editingClass, setEditingClass] = useState(null);
  const [transferForm, setTransferForm] = useState({ userId: null, classId: '' });

  useEffect(() => {
    async function init() {
      try {
        const me = await fetchAdminMe();
        setAdmin(me.data);

        if (me.data.role !== 'super_admin') {
          router.replace('/admin');
          return;
        }

        const [classesResult, teachersResult] = await Promise.all([
          fetchClasses(),
          fetchManagedAdmins()
        ]);

        setClasses(classesResult.data);
        setTeachers(teachersResult.data.filter((a) => a.role === 'teacher'));
        setStatus('success');
      } catch (error) {
        router.replace('/admin/login');
      }
    }

    init();
  }, [router]);

  async function reload() {
    const result = await fetchClasses();
    setClasses(result.data);
  }

  function toggleExpand(classId) {
    setExpandedClassIds((prev) => {
      const next = new Set(prev);

      if (next.has(classId)) {
        next.delete(classId);
      } else {
        next.add(classId);
      }

      return next;
    });
  }

  async function handleCreate(event) {
    event.preventDefault();

    try {
      await createClass({ name: form.name, teacherId: Number(form.teacherId) });
      setForm({ name: '', teacherId: '' });
      await reload();
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleUpdate(event) {
    event.preventDefault();

    try {
      await updateClass({
        id: editingClass.id,
        name: editingClass.name,
        teacherId: Number(editingClass.teacherId)
      });
      setEditingClass(null);
      await reload();
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleDelete(classId) {
    if (!window.confirm('确定要删除这个班级吗？班级里的学生将变为未分班状态。')) {
      return;
    }

    try {
      await deleteClass(classId);
      await reload();
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleTransfer(userId) {
    if (!transferForm.classId) {
      alert('请选择目标班级');
      return;
    }

    try {
      await transferUserClass({ id: userId, classId: Number(transferForm.classId) });
      setTransferForm({ userId: null, classId: '' });
      await reload();
    } catch (error) {
      alert(error.message);
    }
  }

  if (status === 'loading' || !admin) {
    return <p className="empty-text">正在加载班级信息...</p>;
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>班级管理</h1>
          <p>超级管理员可以创建班级、分配老师、给学生转班。</p>
        </div>
      </section>

      <section className="card">
        <h2>创建班级</h2>
        <form className="form-row" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder="班级名称"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
          <select
            value={form.teacherId}
            onChange={(event) => setForm({ ...form, teacherId: event.target.value })}
            required
          >
            <option value="">选择负责老师</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.username}</option>
            ))}
          </select>
          <button type="submit">创建</button>
        </form>
      </section>

      <section className="card">
        <h2>班级列表</h2>
        {classes.length === 0 ? (
          <p className="empty-text">还没有班级</p>
        ) : (
          <div className="class-list">
            {classes.map((cls) => (
              <div key={cls.id} className="class-item">
                <div className="class-header">
                  <button
                    type="button"
                    className="expand-button"
                    onClick={() => toggleExpand(cls.id)}
                  >
                    {expandedClassIds.has(cls.id) ? '▼' : '▶'}
                  </button>
                  <strong>{cls.name}</strong>
                  <span className="class-meta">负责老师：{cls.teacher_name || '未分配'}</span>
                  <span className="class-meta">学生：{cls.students?.length || 0} 人</span>
                  <div className="class-actions">
                    <button type="button" onClick={() => setEditingClass(cls)}>编辑</button>
                    <button type="button" onClick={() => handleDelete(cls.id)}>删除</button>
                  </div>
                </div>

                {editingClass?.id === cls.id && (
                  <form className="form-row edit-form" onSubmit={handleUpdate}>
                    <input
                      type="text"
                      value={editingClass.name}
                      onChange={(event) => setEditingClass({ ...editingClass, name: event.target.value })}
                      required
                    />
                    <select
                      value={editingClass.teacher_id || ''}
                      onChange={(event) => setEditingClass({ ...editingClass, teacherId: event.target.value })}
                      required
                    >
                      {teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>{teacher.username}</option>
                      ))}
                    </select>
                    <button type="submit">保存</button>
                    <button type="button" onClick={() => setEditingClass(null)}>取消</button>
                  </form>
                )}

                {expandedClassIds.has(cls.id) && (
                  <div className="class-students">
                    {cls.students.length === 0 ? (
                      <p className="empty-text">该班级还没有学生</p>
                    ) : (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>学生账号</th>
                            <th>状态</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cls.students.map((student) => (
                            <tr key={student.id}>
                              <td>{student.username}</td>
                              <td>{student.is_active ? '正常' : '已禁用'}</td>
                              <td>
                                <a href={`/admin/users/${student.id}/assignments`}>推送/留言</a>
                                {transferForm.userId === student.id ? (
                                  <>
                                    <select
                                      value={transferForm.classId}
                                      onChange={(event) => setTransferForm({ ...transferForm, classId: event.target.value })}
                                    >
                                      <option value="">选择目标班级</option>
                                      {classes.map((target) => (
                                        <option key={target.id} value={target.id}>{target.name}</option>
                                      ))}
                                    </select>
                                    <button type="button" onClick={() => handleTransfer(student.id)}>确认</button>
                                    <button type="button" onClick={() => setTransferForm({ userId: null, classId: '' })}>取消</button>
                                  </>
                                ) : (
                                  <button type="button" onClick={() => setTransferForm({ userId: student.id, classId: '' })}>转班</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
