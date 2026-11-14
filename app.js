
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);

    let token = localStorage.getItem('vime_token');
    let currentUser = null;
    let currentGroup = null;
    let socket = null;
    let isLogin = true;
    let selectedAvatar = '🕷️';

    const REQUIRED = [
        'auth-view',
        'lobby-view',
        'chat-view',
        'projects-view',
        'toast',
        'auth-form',
        'auth-username',
        'auth-password',
        'tab-login',
        'tab-register',
        'btn-auth-submit',
        'btn-create-group',
        'btn-join-group',
        'invite-code',
        'created-group-info',
        'display-group-code',
        'btn-continue-group',
        'sidebar',
        'messages-container',
        'chat-input',
        'btn-send',
        'btn-attach',
        'file-input',
        'btn-profile',
        'btn-logout',
        'btn-projects',
        'btn-exit',
        'project-group-label',
        'projects-grid',
        'project-modal',
        'close-modal',
        'upload-form',
        'proj-name',
        'proj-version',
        'proj-file',
        'proj-file-label',
        'proj-icon',
        'proj-icon-label',
        'icon-preview',
        'btn-submit-project',
        'profile-modal',
        'close-profile-modal',
        'profile-form',
        'profile-username',
        'profile-password',
        'avatar-selector',
        'bottom-profile-name',
        'bottom-avatar'
    ];

    const missing = REQUIRED.filter(id => !$(id));

    if (missing.length) {
        console.error(
            '[VimeChat] В index.html отсутствуют элементы:',
            missing
        );

        alert(
            'Ошибка HTML! Не найдены элементы: ' +
            missing.join(', ') +
            '. Проверь index.html.'
        );

        return;
    }

    const authView = $('auth-view');
    const lobbyView = $('lobby-view');
    const chatView = $('chat-view');
    const projectsView = $('projects-view');

    const projectModal = $('project-modal');
    const profileModal = $('profile-modal');

    // ==========================================
    // УВЕДОМЛЕНИЯ
    // ==========================================

    function toast(message) {
        const el = $('toast');

        if (!el) {
            console.log('[VimeChat]', message);
            return;
        }

        el.textContent = String(message);
        el.classList.add('show');

        clearTimeout(toast.timer);

        toast.timer = setTimeout(() => {
            el.classList.remove('show');
        }, 2800);
    }

    // ==========================================
    // API
    // ==========================================

    async function api(url, options = {}) {
        const headers = {
            ...(options.body instanceof FormData
                ? {}
                : { 'Content-Type': 'application/json' }),
            ...(token
                ? { Authorization: `Bearer ${token}` }
                : {}),
            ...options.headers
        };

        const response = await fetch(url, {
            ...options,
            headers
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            logout(false);
            throw new Error('Сессия завершена. Войдите снова.');
        }

        if (!response.ok) {
            throw new Error(data.error || 'Ошибка сервера');
        }

        return data;
    }

    // ==========================================
    // ПЕРЕКЛЮЧЕНИЕ СТРАНИЦ
    // ==========================================

    function showView(view) {
        [authView, lobbyView, chatView, projectsView]
            .forEach(element => {
                element.classList.remove('active');
            });

        view.classList.add('active');
    }

    function updateProfileUI() {
        if (!currentUser) return;

        $('bottom-profile-name').textContent =
            currentUser.username;

        $('bottom-avatar').textContent =
            currentUser.avatar || '🕷️';
    }

    // ==========================================
    // SOCKET.IO
    // ==========================================

    function connectSocket() {
        if (socket) {
            socket.disconnect();
        }

        socket = io({
            auth: { token }
        });

        socket.on('connect', () => {
            console.log('[VimeChat] Socket подключён');

            if (currentGroup) {
                socket.emit('join-group', currentGroup.id);
            }
        });

        socket.on('connect_error', error => {
            console.error('[VimeChat] Socket:', error.message);
        });

        socket.on('disconnect', reason => {
            console.log('[VimeChat] Socket отключён:', reason);
        });

        socket.on('new-message', message => {
            if (!currentGroup) return;

            if (message.groupId &&
                Number(message.groupId) !== currentGroup.id) {
                return;
            }

            renderMessage(message);
        });

        socket.on('file', file => {
            if (!currentGroup) return;

            const group = document.createElement('div');
            group.className = 'message-group msg-left';

            const author = document.createElement('div');
            author.className = 'msg-author';
            author.textContent = file.username || 'Пользователь';

            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';

            bubble.textContent =
                `📎 ${file.name} (${formatSize(file.size)})`;

            group.append(author, bubble);

            $('messages-container').appendChild(group);

            scrollMessages();
        });
    }

    // ==========================================
    // АВТОРИЗАЦИЯ
    // ==========================================

    $('tab-login').addEventListener('click', () => {
        isLogin = true;

        $('tab-login').classList.add('active');
        $('tab-register').classList.remove('active');

        $('btn-auth-submit').textContent = 'Войти';
    });

    $('tab-register').addEventListener('click', () => {
        isLogin = false;

        $('tab-register').classList.add('active');
        $('tab-login').classList.remove('active');

        $('btn-auth-submit').textContent =
            'Зарегистрироваться';
    });

    $('auth-form').addEventListener('submit', async event => {
        event.preventDefault();

        const username = $('auth-username').value.trim();
        const password = $('auth-password').value;

        if (!username || !password) {
            return toast('Заполни все поля');
        }

        const button = $('btn-auth-submit');

        button.disabled = true;
        button.textContent = 'Подключение...';

        try {
            const data = await api(
                isLogin ? '/api/login' : '/api/register',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        username,
                        password
                    })
                }
            );

            token = data.token;
            currentUser = data.user;

            localStorage.setItem('vime_token', token);

            await afterLogin();

        } catch (error) {
            toast(error.message);

        } finally {
            button.disabled = false;
            button.textContent = isLogin ? 'Войти' : 'Зарегистрироваться';
        }
    });

    async function afterLogin() {
        connectSocket();

        $('btn-profile').classList.remove('hidden');
        $('btn-logout').classList.remove('hidden');
        $('btn-projects').classList.remove('hidden');

        updateProfileUI();

        $('sidebar').replaceChildren();
        $('messages-container').replaceChildren();

        currentGroup = null;

        $('btn-exit').classList.add('hidden');

        $('created-group-info').classList.add('hidden');
        $('join-group-form').classList.remove('hidden');

        $('invite-code').value = '';

        showView(lobbyView);

        toast(`Добро пожаловать, ${currentUser.username}!`);
    }

    // ==========================================
    // ВЫХОД
    // ==========================================

    function logout(showMessage = true) {
        if (socket) {
            socket.disconnect();
            socket = null;
        }

        token = null;
        currentUser = null;
        currentGroup = null;

        localStorage.removeItem('vime_token');

        $('sidebar').replaceChildren();
        $('messages-container').replaceChildren();
        $('projects-grid').replaceChildren();

        [
            'btn-profile',
            'btn-logout',
            'btn-projects',
            'btn-exit'
        ].forEach(id => {
            $(id).classList.add('hidden');
        });

        $('created-group-info').classList.add('hidden');
        $('join-group-form').classList.remove('hidden');

        $('auth-username').value = '';
        $('auth-password').value = '';

        $('tab-login').click();

        showView(authView);

        if (showMessage) {
            toast('Вы вышли из аккаунта');
        }
    }

    $('btn-logout').addEventListener('click', () => {
        logout();
    });

    // ==========================================
    // СОЗДАНИЕ ГРУППЫ
    // ==========================================

    $('btn-create-group').addEventListener('click', async () => {
        try {
            const data = await api('/api/groups', {
                method: 'POST',
                body: JSON.stringify({})
            });

            currentGroup = data.group;

            $('display-group-code').textContent =
                currentGroup.code;

            $('created-group-info').classList.remove('hidden');
            $('join-group-form').classList.add('hidden');

        } catch (error) {
            toast(error.message);
        }
    });

    $('btn-continue-group').addEventListener('click', async () => {
        if (!currentGroup) return;

        await enterGroup(currentGroup.id);

        $('created-group-info').classList.add('hidden');
        $('join-group-form').classList.remove('hidden');
    });

    // ==========================================
    // ПРИСОЕДИНЕНИЕ К ГРУППЕ
    // ==========================================

    $('btn-join-group').addEventListener('click', async () => {
        const code = $('invite-code').value.trim();

        if (!code) {
            return toast('Введи код приглашения');
        }

        try {
            const data = await api('/api/groups/join', {
                method: 'POST',
                body: JSON.stringify({ code })
            });

            await enterGroup(data.group.id);

        } catch (error) {
            toast(error.message);
        }
    });

    // ==========================================
    // ОТКРЫТИЕ ГРУППЫ
    // ==========================================

    async function enterGroup(id) {
        try {
            const data = await api(`/api/groups/${id}`);

            currentGroup = data.group;

            $('project-group-label').textContent =
                `[${currentGroup.code}]`;

            $('sidebar').replaceChildren();
            $('messages-container').replaceChildren();

            $('btn-exit').classList.remove('hidden');

            renderMembers(currentGroup.members);

            if (socket?.connected) {
                socket.emit('join-group', currentGroup.id);
            }

            const history = await api(
                `/api/groups/${currentGroup.id}/messages`
            );

            history.messages.forEach(renderMessage);

            showView(chatView);

            scrollMessages();

            toast(`Вы вошли в группу ${currentGroup.code}`);

        } catch (error) {
            toast(error.message);
        }
    }

    // ==========================================
    // УЧАСТНИКИ
    // ==========================================

    function renderMembers(members) {
        const sidebar = $('sidebar');

        sidebar.replaceChildren();

        members.forEach(member => {
            const card = document.createElement('div');

            card.className = 'user-card';

            if (member.id === currentUser.id) {
                card.classList.add('active');
            }

            const avatar = document.createElement('div');

            avatar.className = 'avatar avatar-custom';
            avatar.textContent = member.avatar || '🕷️';

            const info = document.createElement('div');
            info.className = 'user-info';

            const name = document.createElement('div');

            name.className = 'user-name';
            name.textContent = member.username;

            const badge = document.createElement('div');

            badge.className = 'badge ' +
                (member.role === 'leader'
                    ? 'role-leader'
                    : 'role-coleader');

            badge.textContent =
                member.role === 'leader' ? 'Leader' : 'Member';

            info.append(name, badge);
            card.append(avatar, info);

            card.addEventListener('click', () => {
                sidebar.querySelectorAll('.user-card')
                    .forEach(element => {
                        element.classList.remove('active');
                    });

                card.classList.add('active');

                $('chat-input').placeholder =
                    `Написать ${member.username}...`;
            });

            sidebar.appendChild(card);
        });
    }

    // ==========================================
    // ВЫХОД ИЗ ГРУППЫ
    // ==========================================

    $('btn-exit').addEventListener('click', async () => {
        if (!currentGroup) return;

        if (!confirm('Покинуть группу?')) return;

        try {
            await api(`/api/groups/${currentGroup.id}/leave`, {
                method: 'POST',
                body: JSON.stringify({})
            });

            currentGroup = null;

            $('sidebar').replaceChildren();
            $('messages-container').replaceChildren();

            $('btn-exit').classList.add('hidden');

            $('project-group-label').textContent = 'Выберите группу';

            showView(lobbyView);

            toast('Вы покинули группу');

        } catch (error) {
            toast(error.message);
        }
    });

    // ==========================================
    // СООБЩЕНИЯ
    // ==========================================

    function renderMessage(message) {
        const own = Number(message.userId) === currentUser.id;

        const group = document.createElement('div');

        group.className = 'message-group ' +
            (own ? 'msg-right' : 'msg-left');

        const author = document.createElement('div');

        author.className = 'msg-author';
        author.textContent = message.username || 'Пользователь';

        const bubble = document.createElement('div');

        bubble.className = 'message-bubble';
        bubble.textContent = message.content;

        group.append(author, bubble);

        $('messages-container').appendChild(group);

        scrollMessages();
    }

    function scrollMessages() {
        const container = $('messages-container');

        container.scrollTop = container.scrollHeight;
    }

    function sendMessage() {
        const input = $('chat-input');
        const content = input.value.trim();

        if (!content || !currentGroup) return;

        if (!socket?.connected) {
            return toast('Нет соединения с сервером');
        }

        socket.emit('send-message', {
            groupId: currentGroup.id,
            content
        });

        input.value = '';

        $('btn-send').disabled = true;
    }

    $('chat-input').addEventListener('input', () => {
        $('btn-send').disabled =
            $('chat-input').value.trim() === '';
    });

    $('btn-send').addEventListener('click', sendMessage);

    $('chat-input').addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    // ==========================================
    // ФАЙЛЫ
    // ==========================================

    function formatSize(size) {
        if (size < 1024) {
            return size + ' B';
        }

        if (size < 1024 * 1024) {
            return (size / 1024).toFixed(1) + ' KB';
        }

        return (size / 1024 / 1024).toFixed(1) + ' MB';
    }

    $('btn-attach').addEventListener('click', () => {
        if (!currentGroup) {
            return toast('Сначала войди в группу');
        }

        $('file-input').click();
    });

    $('file-input').addEventListener('change', async () => {
        const file = $('file-input').files[0];

        if (!file || !currentGroup) return;

        const form = new FormData();

        form.append('file', file);

        try {
            await api(`/api/groups/${currentGroup.id}/files`, {
                method: 'POST',
                body: form
            });

            toast('Файл отправлен');

        } catch (error) {
            toast(error.message);

        } finally {
            $('file-input').value = '';
        }
    });

    // ==========================================
    // ПРОЕКТЫ
    // ==========================================

    $('btn-projects').addEventListener('click', async () => {
        if (projectsView.classList.contains('active')) {
            showView(currentGroup ? chatView : lobbyView);

            $('btn-projects').textContent = 'Проекты';

            return;
        }

        showView(projectsView);

        $('btn-projects').textContent = 'Назад в чат';

        await renderProjects();
    });

    async function renderProjects() {
        const grid = $('projects-grid');

        grid.replaceChildren();

        if (!currentGroup) {
            const empty = document.createElement('p');

            empty.textContent = 'Сначала войди в группу.';

            grid.appendChild(empty);

            return;
        }

        try {
            const data = await api(
                `/api/groups/${currentGroup.id}/projects`
            );

            if (!data.projects.length) {
                const empty = document.createElement('p');

                empty.textContent = 'В группе пока нет проектов.';

                grid.appendChild(empty);

                return;
            }

            data.projects.forEach(project => {
                const card = document.createElement('div');

                card.className = 'project-card';

                const icon = document.createElement('div');

                icon.className = 'project-icon-large';

                if (project.icon &&
                    project.icon.startsWith('data:image/')) {
                    const image = document.createElement('img');

                    image.src = project.icon;
                    image.alt = 'Иконка проекта';

                    icon.appendChild(image);
                } else {
                    icon.textContent = '📦';
                }

                const title = document.createElement('div');

                title.className = 'project-title';
                title.textContent = project.title;

                const author = document.createElement('div');

                author.className = 'project-author';
                author.textContent = project.author;

                const version = document.createElement('div');

                version.className = 'project-version';
                version.textContent = 'Версия: ' + project.version;

                const button = document.createElement('button');

                button.className = 'btn-download-project';
                button.textContent = '⬇️ Скачать';

                button.addEventListener('click', () => {
                    downloadProject(project);
                });

                card.append(
                    icon,
                    title,
                    author,
                    version,
                    button
                );

                grid.appendChild(card);
            });

        } catch (error) {
            toast(error.message);
        }
    }

    async function downloadProject(project) {
        try {
            const response = await fetch(
                `/api/projects/${project.id}/download`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );

            if (!response.ok) {
                throw new Error('Не удалось скачать проект');
            }

            const blob = await response.blob();

            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');

            link.href = url;
            link.download = project.filename;

            document.body.appendChild(link);
            link.click();
            link.remove();

            setTimeout(() => URL.revokeObjectURL(url), 1000);

            toast('Скачивание началось');

        } catch (error) {
            toast(error.message);
        }
    }

    // ==========================================
    // ОКНО ЗАГРУЗКИ
    // ==========================================

    $('btn-open-upload').addEventListener('click', () => {
        if (!currentGroup) {
            return toast('Сначала войди в группу');
        }

        projectModal.classList.add('show');
    });

    function resetProjectForm() {
        $('upload-form').reset();

        $('proj-file-label').textContent =
            '📁 Выбрать файл проекта';

        $('proj-icon-label').textContent =
            '🖼️ Выбрать картинку';

        $('icon-preview').style.display = 'none';
        $('icon-preview').src = '';

        $('btn-submit-project').disabled = true;

        $('btn-submit-project').textContent =
            'Загрузить проект';
    }

    $('close-modal').addEventListener('click', () => {
        projectModal.classList.remove('show');
        resetProjectForm();
    });

    projectModal.addEventListener('click', event => {
        if (event.target === projectModal) {
            projectModal.classList.remove('show');
            resetProjectForm();
        }
    });

    function checkProjectForm() {
        $('btn-submit-project').disabled = !(
            $('proj-name').value.trim() &&
            $('proj-version').value.trim() &&
            $('proj-file').files.length
        );
    }

    $('proj-name').addEventListener('input', checkProjectForm);

    $('proj-version').addEventListener('input', checkProjectForm);

    $('proj-file').addEventListener('change', () => {
        const file = $('proj-file').files[0];

        if (!file) {
            checkProjectForm();
            return;
        }

        const ext = file.name.split('.').pop().toLowerCase();

        if (!['catrobat', 'newtrobat'].includes(ext)) {
            toast('Разрешены только .catrobat и .newtrobat');

            $('proj-file').value = '';

            checkProjectForm();

            return;
        }

        $('proj-file-label').textContent = '✅ ' + file.name;

        checkProjectForm();
    });

    $('proj-icon').addEventListener('change', () => {
        const file = $('proj-icon').files[0];

        if (!file) return;

        if (!file.type.startsWith('image/') ||
            file.size > 1024 * 1024) {
            toast('Изображение должно быть до 1 МБ');

            $('proj-icon').value = '';

            return;
        }

        const reader = new FileReader();

        reader.onload = event => {
            $('icon-preview').src = event.target.result;

            $('icon-preview').style.display = 'block';
        };

        reader.readAsDataURL(file);

        $('proj-icon-label').textContent =
            '🖼️ ' + file.name;
    });

    $('upload-form').addEventListener('submit', async event => {
        event.preventDefault();

        if (!currentGroup) return;

        const file = $('proj-file').files[0];
        const iconFile = $('proj-icon').files[0];

        if (!file) {
            return toast('Выбери файл проекта');
        }

        const form = new FormData();

        form.append('project', file);

        form.append(
            'title',
            $('proj-name').value.trim()
        );

        form.append(
            'version',
            $('proj-version').value.trim()
        );

        if (iconFile) {
            const reader = new FileReader();

            reader.onload = async event => {
                form.append('icon', event.target.result);

                await uploadProject(form);
            };

            reader.readAsDataURL(iconFile);

        } else {
            await uploadProject(form);
        }
    });

    async function uploadProject(form) {
        const button = $('btn-submit-project');

        button.disabled = true;
        button.textContent = 'Загрузка...';

        try {
            await api(
                `/api/groups/${currentGroup.id}/projects`,
                {
                    method: 'POST',
                    body: form
                }
            );

            projectModal.classList.remove('show');

            resetProjectForm();

            toast('Проект успешно загружен!');

            if (projectsView.classList.contains('active')) {
                await renderProjects();
            }

        } catch (error) {
            toast(error.message);

            button.disabled = false;

            button.textContent = 'Загрузить проект';
        }
    }

    // ==========================================
    // ПРОФИЛЬ И АВАТАР
    // ==========================================

    $('avatar-selector').addEventListener('click', event => {
        const option = event.target.closest('.avatar-option');

        if (!option) return;

        selectedAvatar = option.dataset.avatar;

        document.querySelectorAll('.avatar-option')
            .forEach(element => {
                element.classList.remove('selected');
            });

        option.classList.add('selected');
    });

    $('btn-profile').addEventListener('click', () => {
        $('profile-username').value =
            currentUser.username;

        $('profile-password').value = '';

        selectedAvatar = currentUser.avatar || '🕷️';

        document.querySelectorAll('.avatar-option')
            .forEach(option => {
                option.classList.toggle(
                    'selected',
                    option.dataset.avatar === selectedAvatar
                );
            });

        profileModal.classList.add('show');
    });

    $('close-profile-modal').addEventListener('click', () => {
        profileModal.classList.remove('show');
    });

    profileModal.addEventListener('click', event => {
        if (event.target === profileModal) {
            profileModal.classList.remove('show');
        }
    });

    $('profile-form').addEventListener('submit', async event => {
        event.preventDefault();

        const button = $('profile-form').querySelector(
            'button[type="submit"]'
        );

        button.disabled = true;

        try {
            const data = await api('/api/profile', {
                method: 'PATCH',
                body: JSON.stringify({
                    username: $('profile-username').value.trim(),
                    password: $('profile-password').value,
                    avatar: selectedAvatar
                })
            });

            currentUser = data.user;

            updateProfileUI();

            profileModal.classList.remove('show');

            if (currentGroup) {
                await enterGroup(currentGroup.id);
            }

            connectSocket();

            toast('Профиль обновлён!');

        } catch (error) {
            toast(error.message);

        } finally {
            button.disabled = false;
        }
    });

    // ==========================================
    // ЗАПУСК
    // ==========================================

    async function start() {
        if (!token) {
            showView(authView);
            return;
        }

        try {
            const data = await api('/api/me');

            currentUser = data.user;

            await afterLogin();

        } catch (error) {
            console.error('[VimeChat] Авторизация:', error);

            logout(false);

            toast('Войдите в аккаунт');
        }
    }

    start();

    console.log('[VimeChat] Клиент успешно загружен!');
});
