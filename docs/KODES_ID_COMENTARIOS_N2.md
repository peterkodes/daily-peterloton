# Kodes-ID N2 · participação na Viva Mídia

**Objeto:** exigir Kodes-ID para novos comentários e respostas, sem restringir a leitura nem apagar o histórico.

## Jornada do leitor (telas)
1. **Notícia aberta:** leitor pode ler matéria e 116 comentários já aprovados sem cadastro. Se escolher **Comentar**, o portal exibe a mensagem: "Para comentar ou responder, vincule seu Kodes-ID e confirme o nível N2".
2. **Conta Viva Mídia:** visitante não autenticado entra/cria a conta do portal em /account. Quem já tem conta continua com seu histórico, comentários e curtidas.
3. **Autorizar Kodes-ID:** o portal abre `https://app.kodes.com.br/autorizar-comentario-viva` em janela segura com `state` aleatório e `origin` validada. O fluxo apresenta o motivo da exigência e o nível mínimo N2.
4. **Conta Kodes-ID:** usuário entra ou cria Kodes-ID pessoal. Não há cadastro de empresa. É obrigatório confirmar seu e-mail Kodes.
5. **Vincular identidades:** com consentimento, o Kodes confere ambas as sessões no servidor. Não vincula apenas pelo nome ou e-mail, não concede poderes de administrador e não apaga comentários antigos.
6. **N2 de participação:** após confirmar o e-mail Kodes-ID, o leitor preenche o questionário de credencial do protótipo Vértice: áreas de interesse, relação com os temas, autopercepção de conhecimento e declaração de responsabilidade. O servidor registra a emissão da credencial N2; além disso, exige vínculo comprovado com a Viva. O preenchimento é autodeclarado e não comprova diploma, identidade civil nem expertise profissional.
7. **Autorizar:** o Kodes emite um ticket aleatório, de uso único, válido por 5 minutos, entregue apenas à janela Viva com `postMessage` de origem e estado verificados. A API Viva envia o ticket ao servidor Kodes e recebe autorização de publicação temporária.
8. **Voltar ao artigo:** a página original libera o mesmo formulário preservando rascunho e contexto, com status "Kodes-ID N2 confirmado". O comentário é enviado como `pending`, passa por moderação normal da Viva; também se aplica a respostas. A validação N2 é reexigida após expiração.
9. **Histórico e revogação:** comentários anteriores continuam legíveis; usuário pode desvincular identidade no Kodes, invalidando novos tickets. Autorizações previamente emitidas duram no máximo 10 minutos; não há elevação de permissões administrativas.

## Regras de backend
- Viva: `kodes-comment-grant` autentica o leitor no Supabase Viva e valida ticket na API Kodes. `kodes_comment_grants` tem RLS de leitura somente pelo próprio leitor e gravação somente por serviço.
- Kodes: `kodes-viva-comment-access` exige conta Kodes e-mail confirmado, vínculo válido e mínimo N2, emite ticket e valida o resgate; procedimento SQL consome ticket uma única vez.
- **Portão de ativação:** só aplicar `20261124212000_enforce_kodes_comment_n2_after_deploy.sql` depois que ambos os frontends estiverem publicados e uma conta real completar o percurso de autorização. A policy RESTRICTIVE é combinada com a RLS normal do portal e bloqueia todos os INSERTs sem grant, mesmo via REST.
- As credenciais antigas do portal continuam válidas para leitura, administração e gestão de contas. Administradores também precisam de identidade Kodes para publicar novos comentários; seu cargo não é concedido pelo Kodes.

## Testes indispensáveis
- [ ] Leitor anônimo lê conteúdo, mas não envia comentário.
- [ ] Leitor Viva com login, sem Kodes, recebe CTA.
- [ ] Leitor Kodes logado, mas sem vínculo, não recebe ticket.
- [ ] E-mail Kodes não confirmado não recebe ticket.
- [ ] Sem questionário N2 preenchido, não recebe ticket; campos obrigatórios e responsabilidade precisam ser aceitos.
- [ ] Consentimento e sessões válidas criam um único vínculo.
- [ ] Conta Viva A não consegue resgatar ticket vinculado à Viva B.
- [ ] Ticket expirado, repetido ou adulterado é rejeitado.
- [ ] Após grant N2, postagem e resposta entram como pendentes, com moderação da Viva.
- [ ] Depois de expiração do grant, cliente e API direta rejeitam INSERT.
- [ ] Rascunho e histórico original continuam intactos.
- [ ] Usuário de uma empresa não recebe acesso a dados ou privilégios de outra.
