<?php
$tasksFile = __DIR__ . '/tasks.json';
$tasks = [];
if (file_exists($tasksFile)) {
    $json = file_get_contents($tasksFile);
    $tasks = json_decode($json, true) ?: [];
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    if ($action === 'add') {
        $text = trim($_POST['text'] ?? '');
        if ($text !== '') {
            $tasks[] = ['text' => $text, 'done' => false];
        }
    } elseif ($action === 'toggle') {
        $idx = intval($_POST['index'] ?? -1);
        if (isset($tasks[$idx])) {
            $tasks[$idx]['done'] = !$tasks[$idx]['done'];
        }
    } elseif ($action === 'delete') {
        $idx = intval($_POST['index'] ?? -1);
        if (isset($tasks[$idx])) {
            array_splice($tasks, $idx, 1);
        }
    }
    file_put_contents($tasksFile, json_encode($tasks, JSON_PRETTY_PRINT));
    header('Location: ' . $_SERVER['PHP_SELF']);
    exit;
}
?>
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PHP To-Do List</title>
<style>
body {font-family: Arial, sans-serif; margin: 2em;}
.container {max-width: 600px; margin: auto;}
ul {list-style: none; padding: 0;}
li {display: flex; align-items: center; margin-bottom: 0.5em;}
li span {flex-grow: 1; margin-left: 0.5em;}
li.done span {text-decoration: line-through; color: #777;}
button.delete {margin-left: 0.5em;}
form.inline {display:inline;}
</style>
</head>
<body>
<div class="container">
<h1>To-Do List</h1>
<form method="post" style="margin-bottom:1em;">
  <input type="hidden" name="action" value="add">
  <input type="text" name="text" placeholder="Add new task">
  <button type="submit">Add</button>
</form>
<ul>
<?php foreach ($tasks as $i => $task): ?>
  <li class="<?= $task['done'] ? 'done' : '' ?>">
    <form method="post" class="inline">
      <input type="hidden" name="action" value="toggle">
      <input type="hidden" name="index" value="<?= $i ?>">
      <input type="checkbox" onclick="this.form.submit()" <?= $task['done'] ? 'checked' : '' ?>>
    </form>
    <span><?= htmlspecialchars($task['text'], ENT_QUOTES, 'UTF-8') ?></span>
    <form method="post" class="inline">
      <input type="hidden" name="action" value="delete">
      <input type="hidden" name="index" value="<?= $i ?>">
      <button type="submit" class="delete">Delete</button>
    </form>
  </li>
<?php endforeach; ?>
</ul>
</div>
</body>
</html>
