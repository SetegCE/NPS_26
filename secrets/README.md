# secrets/

Material sensível que **nunca** entra no git. O `.gitignore` ignora tudo nesta
pasta menos este README.

| Arquivo | O que é |
|---|---|
| `usuarios-iniciais.json` | Carga inicial de usuários lida por `scripts/seed-usuarios.mjs`. Contém senhas em claro. |

## usuarios-iniciais.json

É o único lugar onde uma senha aparece legível, e só para a distribuição
inicial. No banco vai apenas o hash scrypt — `usuarios_nps.senha_hash`.

```jsonc
{
  "usuarios": [
    {
      "nome":  "Fulana de Tal",
      "email": "fulana@setegce.com",
      "senha": "...",
      "papel": "lider",          // "pmo" enxerga tudo; "lider", só os seus
      "lider": "FULANA"          // nome em lideres_nps — amarra o escopo
    }
  ]
}
```

Rodar o seed:

```bash
node scripts/seed-usuarios.mjs            # simulação
node scripts/seed-usuarios.mjs --aplicar  # grava
```

É idempotente. Reexecutar **redefine a senha** de quem estiver no arquivo, e é
assim que se atende a um "esqueci minha senha" enquanto não existe tela de
gestão de acessos.

**Depois de distribuir os acessos, apague este arquivo.** O sistema não precisa
dele para funcionar — só para criar usuário ou redefinir senha. Cada dia a mais
com ele no disco é um dia a mais de senha em claro parada numa pasta.

Distribua cada senha pela pessoa, por canal privado. Nunca num grupo, nunca
num e-mail com várias pessoas em cópia.
