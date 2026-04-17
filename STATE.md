# STATE

- current goal: сделать `links` постоянной облачной точкой входа для работы с проектами с телефона и компьютера
- current task: удерживать pipeline доставки команд в одном предсказуемом виде `create -> dispatch once -> ack/result -> ingest -> UI`, без recovery/retry логики в hot path
- next step: подключить внешний cron или ручной trigger на `/api/admin/commands-maintenance`, затем прогнать production smoke на cloud reply, bridge timeout fallback и UI retry actions
